import { initTRPC } from "@trpc/server";
import { z } from "zod";
import {
  getRecentConversations,
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
} from "./facebook.js";
import { getLastWebhookDelivery } from "./routes/webhook.js";
import { syncFeed, listFeed, countFeed } from "./feed.js";
import {
  listArtistUploads,
  markUploadUsed,
  deleteArtistUpload,
  countUploadsToday,
} from "./uploads.js";
import { testLlm, llmProvider, llmModel, llmBaseUrl, getLastLlmError } from "./llm.js";

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
            .refine((v) => /^https?:\/\//.test(v) || v.startsWith("/api/attachments/"), {
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
          appId: z.string().min(1),
          appSecret: z.string(),
          webhookVerifyToken: z.string().min(1),
          pageName: z.string().optional(),
        })
      )
      .mutation(({ input }) => setFacebookConfig(input)),
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
      lastDelivery: getLastWebhookDelivery(),
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
