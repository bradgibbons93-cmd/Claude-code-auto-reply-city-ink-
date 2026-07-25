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
  deleteKnowledge,
  getStats,
  pauseBot,
  resumeBot,
} from "./db.js";
import { generateCaption } from "./agent.js";

const t = initTRPC.create();
const publicProcedure = t.procedure;

export const appRouter = t.router({
  stats: publicProcedure.query(() => getStats()),

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
  }),

  knowledge: t.router({
    list: publicProcedure.query(() => getStudioKnowledge()),
    create: publicProcedure
      .input(z.object({ question: z.string().min(1), answer: z.string().min(1) }))
      .mutation(({ input }) => createKnowledge(input.question, input.answer)),
    remove: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ input }) => deleteKnowledge(input.id)),
  }),

  config: t.router({
    facebook: publicProcedure.query(async () => {
      const config = await getFacebookConfig();
      if (!config) return null;
      // Never ship secrets to the browser.
      return {
        pageId: config.pageId,
        pageName: config.pageName,
        appId: config.appId,
        isConfigured: config.isConfigured,
        hasToken: !!config.pageAccessToken,
      };
    }),
    saveFacebook: publicProcedure
      .input(
        z.object({
          pageId: z.string().min(1),
          pageAccessToken: z.string().min(1),
          appId: z.string().min(1),
          appSecret: z.string().min(1),
          webhookVerifyToken: z.string().min(1),
          pageName: z.string().optional(),
        })
      )
      .mutation(({ input }) => setFacebookConfig(input)),
    timely: publicProcedure.query(() => getTimelyConfig().catch(() => null)),
    saveTimely: publicProcedure
      .input(
        z.object({
          bookingPageUrl: z.string().url(),
          businessId: z.string().optional(),
          defaultServiceId: z.string().optional(),
        })
      )
      .mutation(({ input }) => setTimelyConfig(input)),
  }),
});

export type AppRouter = typeof appRouter;
