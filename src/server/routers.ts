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
  getStats,
  getDashboardStats,
  pauseBot,
  resumeBot,
} from "./db.js";
import {
  generateCaption,
  approveDraft,
  rejectDraft,
  practiceReply,
  suggestPosts,
} from "./agent.js";
import { getUpcomingBookings, findFreeSlots } from "./calendar.js";
import { getLastProfileError, backfillCustomerNames } from "./facebook.js";
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
          imageUrl: z.string().url().optional(),
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
        hasOwner: !!config.ownerPsid,
        // Why customers show as "Unknown customer", if they do.
        lastProfileError: getLastProfileError(),
      };
    }),
    saveFacebook: publicProcedure
      .input(
        z.object({
          pageId: z.string().min(1),
          // Blank is allowed on an update — it means "keep the saved one".
          // setFacebookConfig() only accepts that when a row already exists.
          pageAccessToken: z.string(),
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
