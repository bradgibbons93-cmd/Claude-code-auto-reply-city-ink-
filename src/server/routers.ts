import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getRecentConversations,
  searchInbox,
  getConversationMessages,
  getActiveAutoReplyRules,
  createAutoReplyRule,
  deleteAutoReplyRule,
  getScheduledPosts,
  createScheduledPost,
  updatePostStatus,
  deletePost,
  getFacebookConfig,
  setFacebookConfig,
  getTimelyConfig,
  setTimelyConfig,
  getStudioKnowledge,
  createKnowledge,
  updateKnowledge,
  deleteKnowledge,
  getPendingReplies,
  importExampleExchanges,
  learnFromStoredChats,
  countExampleExchanges,
  clearExampleExchanges,
  getRecentDraftEdits,
  recordDraftEdit,
  updateDraftEdit,
  deleteDraftEdit,
  getConversationsMissingNames,
  getStats,
  getDashboardStats,
  pauseBot,
  resumeBot,
} from "./db.js";
import {
  generateCaption,
  approveDraft,
  rejectDraft,
  redraftPendingReply,
  draftForUnanswered,
  practiceReply,
  suggestPosts,
} from "./agent.js";
import { getUpcomingBookings, findFreeSlots } from "./calendar.js";
import {
  getLastProfileError,
  explainProfileFailure,
  backfillCustomerNames,
  importExistingConversations,
  getMessengerSubscription,
  subscribePageToApp,
  ensureMessengerSubscription,
} from "./facebook.js";
import { getLastWebhookDelivery } from "./routes/webhook.js";
import { getStoredWebhookDelivery, getWebhookRejections } from "./db.js";
import { syncFeed, listFeed, countFeed } from "./feed.js";
import { makeTokenLast, describeToken, instagramTokenHost } from "./token.js";
import {
  listArtistUploads,
  markUploadUsed,
  deleteArtistUpload,
  countUploadsToday,
} from "./uploads.js";
import { testLlm, llmProvider, llmModel, llmBaseUrl, getLastLlmError } from "./llm.js";
import { bulkSchedule, describeUploads, BulkRejected } from "./bulk.js";
import {
  getVapidKeys,
  saveSubscription,
  removeSubscription,
  listSubscriptions,
  countSubscriptions,
  getNotifySettings,
  setNotifySettings,
  sendPush,
} from "./push.js";

/**
 * What counts as a picture this app can hand to Facebook.
 *
 * Three shapes: anything already on the internet, a photo uploaded straight
 * into the composer, and — the one that was missing — a photo out of the
 * studio gallery. Picking from the gallery was offered in the UI and then
 * refused here, so the pick simply failed to save.
 */
function isPostImage(value: string): boolean {
  return (
    /^https?:\/\//.test(value) ||
    value.startsWith("/api/attachments/") ||
    value.startsWith("/api/uploads/")
  );
}

/**
 * Work out which Meta host a pasted Instagram token belongs to, so it gets
 * sent somewhere that will accept it. Only when one was actually typed —
 * blank means keep what's saved, host included.
 */
async function withInstagramHost<T extends { instagramAccessToken?: string; appId: string; appSecret: string }>(
  input: T
): Promise<T & { instagramTokenHost?: "facebook" | "instagram" }> {
  if (!input.instagramAccessToken) return input;
  const existing = await getFacebookConfig().catch(() => undefined);
  return {
    ...input,
    instagramTokenHost: await instagramTokenHost(
      input.instagramAccessToken,
      input.appId || existing?.appId,
      input.appSecret || existing?.appSecret
    ),
  };
}

const t = initTRPC.create();
const publicProcedure = t.procedure;

export const appRouter = t.router({
  stats: publicProcedure.query(() => getStats()),
  dashboard: publicProcedure.query(() => getDashboardStats()),

  calendar: t.router({
    upcoming: publicProcedure.query(() => getUpcomingBookings()),
    freeSlots: publicProcedure.query(() => findFreeSlots({ limit: 5 })),
  }),

  llm: t.router({
    // Cheap: reports the settings without calling anyone.
    status: publicProcedure.query(() => ({
      provider: llmProvider(),
      model: llmModel(),
      baseUrl: llmBaseUrl(),
      keySet: !!process.env.LLM_API_KEY,
      lastError: getLastLlmError(),
    })),
    // A mutation so it only ever fires on a click, never on a page load.
    test: publicProcedure.mutation(() => testLlm()),
  }),

  /**
   * The studio's own posts. Read from our copy; refreshing goes to Facebook.
   */
  feed: t.router({
    list: publicProcedure.query(() => listFeed()),
    count: publicProcedure.query(() => countFeed()),
    refresh: publicProcedure
      .input(z.object({ days: z.number().min(1).max(365).default(120) }).default({ days: 120 }))
      .mutation(({ input }) => syncFeed(input.days)),
  }),

  /**
   * The artists' end-of-day photos. Uploading is a plain POST so a phone can
   * do it without the app's JavaScript; everything here is the studio side —
   * looking through them, marking what's been used, clearing what hasn't.
   */
  uploads: t.router({
    list: publicProcedure
      .input(z.object({ unusedOnly: z.boolean().default(false) }).default({ unusedOnly: false }))
      .query(({ input }) => listArtistUploads({ unusedOnly: input.unusedOnly })),
    countToday: publicProcedure.query(() => countUploadsToday()),
    markUsed: publicProcedure
      .input(z.object({ id: z.string(), used: z.boolean() }))
      .mutation(({ input }) => markUploadUsed(input.id, input.used)),
    remove: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => deleteArtistUpload(input.id)),
  }),

  conversations: t.router({
    list: publicProcedure.query(() => getRecentConversations()),
    messages: publicProcedure
      .input(z.object({ conversationId: z.string() }))
      .query(({ input }) => getConversationMessages(input.conversationId)),
    pause: publicProcedure
      .input(z.object({ conversationId: z.string(), hours: z.number().default(12) }))
      .mutation(({ input }) => pauseBot(input.conversationId, input.hours)),
    resume: publicProcedure
      .input(z.object({ conversationId: z.string() }))
      .mutation(({ input }) => resumeBot(input.conversationId)),
  }),

  pendingReplies: t.router({
    list: publicProcedure.query(() => getPendingReplies()),
    approve: publicProcedure
      .input(z.object({ id: z.number(), editedText: z.string().optional() }))
      .mutation(({ input }) => approveDraft(input.id, input.editedText)),
    reject: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ input }) => rejectDraft(input.id)),
    // Ask the model again on a card it failed to write, rather than making
    // the studio start from a blank box.
    redraft: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ input }) => redraftPendingReply(input.id)),
    // Imported threads get no draft — importing writes to nobody. This is
    // the deliberate second step, for the people who asked something weeks
    // ago and were missed.
    draftUnanswered: publicProcedure
      .input(z.object({ limit: z.number().min(1).max(50).default(20) }).default({ limit: 20 }))
      .mutation(({ input }) => draftForUnanswered(input.limit)),
  }),

  autoReply: t.router({
    getRules: publicProcedure.query(() => getActiveAutoReplyRules()),
    createRule: publicProcedure
      .input(
        z.object({
          triggerKeywords: z.array(z.string()).min(1),
          responseText: z.string().min(1),
          sendBookingLink: z.boolean().default(false),
        })
      )
      .mutation(({ input }) =>
        createAutoReplyRule(input.triggerKeywords, input.responseText, input.sendBookingLink)
      ),
    deleteRule: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ input }) => deleteAutoReplyRule(input.id)),
  }),

  posts: t.router({
    getScheduled: publicProcedure.query(() => getScheduledPosts()),
    create: publicProcedure
      .input(
        z.object({
          content: z.string().min(1),
          scheduledAt: z.coerce.date(),
          // Either a link to somewhere on the internet, or the path to a
          // photo uploaded here. Requiring a URL is what forced the studio
          // to have the picture online already — which for one just taken
          // on a phone it never is.
          imageUrl: z
            .string()
            .refine((v) => isPostImage(v), {
              message: "Needs to be a link, or a photo uploaded here.",
            })
            .optional(),
          aiGenerated: z.boolean().default(false),
        })
      )
      .mutation(({ input }) =>
        createScheduledPost(input.content, input.scheduledAt, input.imageUrl, input.aiGenerated)
      ),
    updateStatus: publicProcedure
      .input(
        z.object({
          id: z.number(),
          status: z.enum(["draft", "scheduled", "published", "failed"]),
        })
      )
      .mutation(({ input }) => updatePostStatus(input.id, input.status)),
    remove: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ input }) => deletePost(input.id)),
    generateCaption: publicProcedure
      .input(z.object({ prompt: z.string().min(1) }))
      .mutation(async ({ input }) => ({ caption: await generateCaption(input.prompt) })),
    suggest: publicProcedure.mutation(() => suggestPosts()),

    /**
     * A week of posts in one go.
     *
     * The photos are already here — the artists send them in every day. What
     * was missing was any way to turn eleven of them into eleven posts
     * without opening the composer eleven times.
     */
    bulkSchedule: publicProcedure
      .input(
        z.object({
          photos: z
            .array(
              z.object({
                imageUrl: z.string().refine(isPostImage, {
                  message: "That photo isn't one this app can publish.",
                }),
                caption: z.string().max(4000).optional(),
                uploadId: z.string().max(64).optional(),
              })
            )
            .min(1)
            .max(60),
          startDate: z.coerce.date(),
          timeOfDay: z
            .string()
            .regex(/^\d{1,2}:\d{2}$/, "Use a time like 11:00")
            .default("11:00"),
          spacingDays: z.number().int().min(1).max(30).default(1),
          sharedCaption: z.string().max(4000).optional(),
          writeCaptions: z.boolean().default(false),
          avoidClashes: z.boolean().default(true),
        })
      )
      .mutation(async ({ input }) => {
        // Gallery picks carry the artist's own note, which is the only
        // honest brief an AI caption can have — the model can't see the
        // photo, so without it it would be inventing the tattoo.
        const details = await describeUploads(
          input.photos.map((p) => p.uploadId).filter((id): id is string => !!id)
        );

        const items = input.photos.map((photo) => {
          const known = photo.uploadId ? details.get(photo.uploadId) : undefined;
          return {
            imageUrl: photo.imageUrl,
            caption: photo.caption,
            note: known?.note,
            artistName: known?.artistName,
            uploadId: photo.uploadId,
          };
        });

        try {
          const { scheduled } = await bulkSchedule(items, {
            startDate: input.startDate,
            timeOfDay: input.timeOfDay,
            spacingDays: input.spacingDays,
            sharedCaption: input.sharedCaption,
            writeCaptions: input.writeCaptions,
            avoidClashes: input.avoidClashes,
          });
          return {
            scheduled: scheduled.map((post) => ({
              imageUrl: post.imageUrl,
              caption: post.caption,
              scheduledAt: post.scheduledAt,
              aiGenerated: post.aiGenerated,
            })),
          };
        } catch (error) {
          if (error instanceof BulkRejected) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          throw error;
        }
      }),
  }),

  /**
   * Rehearsal. Draft a reply to a made-up enquiry and keep the good ones.
   * Nothing here can reach a customer — practice never queues or sends.
   */
  practice: t.router({
    draft: publicProcedure
      .input(
        z.object({
          message: z.string().min(1),
          priorTurns: z
            .array(
              z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string(),
              })
            )
            .max(20)
            .default([]),
        })
      )
      .mutation(({ input }) => practiceReply(input.message, input.priorTurns)),

    // Thumbs up saves it as an example. An edit saves the corrected version
    // AND records the difference, which is weighted more heavily than
    // anything else the agent reads.
    keep: publicProcedure
      .input(
        z.object({
          customerMessage: z.string().min(1),
          reply: z.string().min(1),
          originalDraft: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const result = await importExampleExchanges(
          [{ customerMessage: input.customerMessage, studioReply: input.reply }],
          "practice"
        );
        if (input.originalDraft && input.originalDraft !== input.reply) {
          await recordDraftEdit(input.originalDraft, input.reply, input.customerMessage);
        }
        return result;
      }),
  }),

  /**
   * Notifications on the studio's phone.
   *
   * Deliberately separate from the Facebook settings: this is the app's own
   * channel and it has to keep working when Facebook doesn't, which is the
   * whole reason it exists.
   */
  push: t.router({
    /** What the browser needs to subscribe. Public by design — it identifies
     * this server to the push service and grants nothing on its own. */
    key: publicProcedure.query(async () => ({ publicKey: (await getVapidKeys()).publicKey })),

    status: publicProcedure.query(async () => ({
      devices: await listSubscriptions(),
      count: await countSubscriptions(),
      settings: await getNotifySettings(),
    })),

    subscribe: publicProcedure
      .input(
        z.object({
          endpoint: z.string().url().max(2000),
          keys: z.object({ p256dh: z.string().max(255), auth: z.string().max(255) }),
          label: z.string().max(190).optional(),
        })
      )
      .mutation(({ input }) =>
        saveSubscription({ endpoint: input.endpoint, keys: input.keys }, input.label)
      ),

    unsubscribe: publicProcedure
      .input(z.object({ endpoint: z.string().max(2000) }))
      .mutation(async ({ input }) => {
        await removeSubscription(input.endpoint);
        return { ok: true };
      }),

    saveSettings: publicProcedure
      .input(
        z.object({
          onMessage: z.boolean().optional(),
          onBooking: z.boolean().optional(),
          onDraft: z.boolean().optional(),
          onProblem: z.boolean().optional(),
          quietFrom: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
          quietTo: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
          throttleMinutes: z.number().int().min(0).max(180).optional(),
        })
      )
      .mutation(({ input }) => setNotifySettings(input)),

    // The only honest way to know it works. "Subscribed" is a claim; a buzz
    // in the pocket is the evidence.
    test: publicProcedure.mutation(async () => {
      const { sent } = await sendPush({
        title: "City Ink — test",
        body: "Notifications are working. This is what a new enquiry will look like.",
        url: "/messages",
        tag: "test",
      });
      return { sent };
    }),
  }),

  /** The header search box, which until now was decorative. */
  search: publicProcedure
    .input(z.object({ query: z.string().max(200) }))
    .query(({ input }) => searchInbox(input.query)),

  knowledge: t.router({
    list: publicProcedure.query(() => getStudioKnowledge()),
    create: publicProcedure
      .input(z.object({ question: z.string().min(1), answer: z.string().min(1) }))
      .mutation(({ input }) => createKnowledge(input.question, input.answer)),
    update: publicProcedure
      .input(
        z.object({
          id: z.number(),
          question: z.string().min(1),
          answer: z.string().min(1),
        })
      )
      .mutation(({ input }) => updateKnowledge(input.id, input.question, input.answer)),
    remove: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ input }) => deleteKnowledge(input.id)),
  }),

  history: t.router({
    count: publicProcedure.query(() => countExampleExchanges()),
    edits: publicProcedure.query(() => getRecentDraftEdits(20)),
    // A correction outweighs everything else the agent reads, so a wrong one
    // has to be fixable — not just visible.
    updateEdit: publicProcedure
      .input(z.object({ id: z.number(), sentText: z.string().min(1) }))
      .mutation(({ input }) => updateDraftEdit(input.id, input.sentText)),
    removeEdit: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ input }) => deleteDraftEdit(input.id)),
    // Pairs are extracted in the browser so a big export never has to be
    // uploaded whole; only the useful message/reply pairs come over.
    import: publicProcedure
      .input(
        z.object({
          source: z.string().optional(),
          pairs: z
            .array(z.object({ customerMessage: z.string(), studioReply: z.string() }))
            .max(5000),
        })
      )
      .mutation(({ input }) => importExampleExchanges(input.pairs, input.source)),
    clear: publicProcedure.mutation(() => clearExampleExchanges()),
    // Everything the app already holds. Uploading Facebook's export was the
    // only way to teach it, while thousands of real exchanges sat unused in
    // its own database.
    learnFromInbox: publicProcedure.mutation(() => learnFromStoredChats()),
  }),

  config: t.router({
    facebook: publicProcedure.query(async () => {
      const config = await getFacebookConfig();
      if (!config) return null;
      // Never ship secrets to the browser — token and app secret stay out.
      return {
        pageId: config.pageId,
        pageName: config.pageName,
        appId: config.appId,
        webhookVerifyToken: config.webhookVerifyToken,
        isConfigured: config.isConfigured,
        hasToken: !!config.pageAccessToken,
        // The value never leaves the server; the browser only needs to know
        // whether one is saved so the field can say so.
        hasInstagramToken: !!config.instagramAccessToken,
        hasInstagramAppSecret: !!config.instagramAppSecret,
        hasOwner: !!config.ownerPsid,
        // Why customers show as "a customer" — but ONLY when any actually
        // do. The per-person profile lookup fails for this app and always
        // will; names come from the Page inbox instead. Reporting that
        // failure while every name on screen is correct is crying wolf,
        // and it sent Brad chasing a problem that wasn't there.
        lastProfileError: await (async () => {
          if ((await getConversationsMissingNames(1)).length === 0) return null;
          const raw = getLastProfileError();
          if (!raw) return null;
          // A sentence, not a Graph dump. The raw text is kept alongside for
          // the times it's genuinely something new.
          return { ...raw, message: explainProfileFailure(raw.message), raw: raw.message };
        })(),
        unnamedConversations: (await getConversationsMissingNames(200)).length,
        // When the saved token dies, and whether it already has. Everything
        // in this app goes quiet at once when it expires — no messages, no
        // names, no import — and until now nothing said so until the morning
        // after. Asked of Facebook directly, so it can't drift.
        token: await (async () => {
          if (!config.pageAccessToken || !config.appId || !config.appSecret) return null;
          const facts = await describeToken(
            config.pageAccessToken,
            config.appId,
            config.appSecret
          );
          if (!facts) return null;
          return {
            valid: facts.valid,
            expiresAt: facts.expiresAt?.toISOString() ?? null,
            permanent: facts.valid && !facts.expiresAt,
          };
        })(),
      };
    }),
    saveFacebook: publicProcedure
      .input(
        z.object({
          pageId: z.string().min(1),
          // Blank is allowed on an update — it means "keep the saved one".
          // setFacebookConfig() only accepts that when a row already exists.
          pageAccessToken: z.string(),
          // Blank means "keep whatever's saved", same as the Page token.
          instagramAccessToken: z.string().optional(),
          // Instagram signs its webhooks with its own app secret. Blank means
          // "keep the saved one", same as every other secret on this form.
          instagramAppSecret: z.string().optional(),
          appId: z.string().min(1),
          appSecret: z.string(),
          webhookVerifyToken: z.string().min(1),
          pageName: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        // A token pasted straight from the Graph API Explorer dies within the
        // hour, silently, and takes the whole inbox with it when it does. So
        // upgrade it here rather than asking anyone to know the difference.
        // Blank means "keep the saved one", which is not a paste at all.
        // Blank token box means "keep the saved one" — but pressing Save is
        // still someone asking for this to work, so the delivery check runs
        // either way. Skipping it here would have made the most natural thing
        // to try next, saving again, do nothing at all.
        if (!input.pageAccessToken) {
          await setFacebookConfig(await withInstagramHost(input));
          const only = await ensureMessengerSubscription().catch((error: Error) => ({
            action: "failed" as const,
            detail: error.message,
          }));
          return {
            detail:
              only.action === "resubscribed"
                ? "Saved. Facebook had stopped sending messages to the app, so I've turned that back on — new messages will arrive from now."
                : only.action === "failed"
                  ? `Saved. One thing left: Facebook isn't delivering messages to the app yet — ${only.detail}`
                  : "Saved. Facebook is delivering messages to the app.",
            subscription: only.action,
          };
        }
        const existing = await getFacebookConfig();
        const report = await makeTokenLast(
          input.pageAccessToken,
          input.appId || existing?.appId,
          input.appSecret || existing?.appSecret,
          input.pageId || existing?.pageId
        );
        await setFacebookConfig({
          ...(await withInstagramHost(input)),
          pageAccessToken: report.token,
          // Facebook just told us which Page this is. Believe it over the box.
          pageId: report.pageId ?? input.pageId,
          pageName: report.pageName ?? input.pageName,
        });

        /**
         * Put the subscription back now, not in six hours.
         *
         * Facebook drops a Page's subscription after sustained delivery
         * failures, and an expired token causes exactly that. So the moment a
         * token stops working is the moment the subscription starts dying —
         * and pasting a new one is the moment it can be repaired. Leaving that
         * to the boot check or the six-hourly cron meant a token could be
         * fixed and the inbox still receive nothing, with the screen showing a
         * green token and no messages, which is the most confusing state of
         * all. Idempotent: when the subscription is fine this is one read.
         */
        const sub = await ensureMessengerSubscription().catch((error: Error) => ({
          action: "failed" as const,
          detail: error.message,
        }));
        const subDetail =
          sub.action === "resubscribed"
            ? " Facebook had stopped sending messages to the app, so I've turned that back on — new messages will arrive from now."
            : sub.action === "failed"
              ? ` One thing left: Facebook isn't delivering messages to the app yet — ${sub.detail}`
              : "";

        return { detail: `${report.detail}${subDetail}`, subscription: sub.action };
      }),
    // Go and fetch names for the threads already sitting there as
    // "a customer" — a webhook is never coming to fix those on its own.
    refreshNames: publicProcedure.mutation(() => backfillCustomerNames()),
    // Everyone who wrote in before the app was watching. A webhook only ever
    // carries what happens next, so without this they stay invisible until
    // they happen to message again.
    importThreads: publicProcedure.mutation(() => importExistingConversations()),

    /**
     * Is Facebook actually delivering? Verifying the webhook URL is only half
     * of it — the Page must also be subscribed to the app, and until it is,
     * Facebook sends nothing and says nothing.
     */
    messengerDelivery: publicProcedure.query(async () => ({
      ...(await getMessengerSubscription()),
      // Whatever this process has seen, or failing that what the database
      // remembers from before the last deploy. Held only in memory, this read
      // "nothing has ever arrived" after every push.
      lastDelivery: getLastWebhookDelivery() ?? (await getStoredWebhookDelivery()),
      // Facebook delivering and us refusing is a different failure from
      // Facebook not delivering, and the opposite of "nothing is arriving".
      rejected: await getWebhookRejections(),
    })),
    subscribeMessenger: publicProcedure.mutation(() => subscribePageToApp()),
    timely: publicProcedure.query(() => getTimelyConfig().catch(() => null)),
    saveTimely: publicProcedure
      .input(
        z.object({
          bookingPageUrl: z.string().url(),
          businessId: z.string().optional(),
          defaultServiceId: z.string().optional(),
          calendarIcsUrl: z.string().url().optional().or(z.literal("")),
        })
      )
      .mutation(({ input }) => setTimelyConfig(input)),
  }),
});

export type AppRouter = typeof appRouter;
