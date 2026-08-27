import cron from "node-cron";
import { getDuePosts, updatePostStatus } from "./db.js";
import { publishPagePost } from "./facebook.js";
import { syncFeed } from "./feed.js";
import { ensureMessengerSubscription } from "./facebook.js";

/**
 * Runs every minute. Each post is flipped to "draft" before publishing so a
 * second worker (or a restart mid-run) can't post the same thing twice.
 */
export function startScheduler() {
  // A subscription can lapse mid-life, not just across a restart — an outage
  // long enough for Facebook to give up doesn't need a redeploy to happen.
  // Every six hours, cheap when nothing is wrong.
  cron.schedule("21 */6 * * *", async () => {
    try {
      const { action, detail } = await ensureMessengerSubscription();
      if (action !== "none") console.log(`[Facebook] Messenger subscription ${action} — ${detail}`);
    } catch (error) {
      console.error("[Facebook] Subscription check failed:", (error as Error).message);
    }
  });

  // Keep the feed current. Hourly is plenty — a studio posts a few times a
  // week, and this costs a Graph call, not a page load.
  cron.schedule("7 * * * *", async () => {
    try {
      await syncFeed(14);
    } catch (error) {
      console.error("[Feed] Hourly refresh failed:", (error as Error).message);
    }
  });

  cron.schedule("* * * * *", async () => {
    let due: Awaited<ReturnType<typeof getDuePosts>> = [];
    try {
      due = await getDuePosts();
    } catch (error) {
      console.error("[Scheduler] Could not read due posts:", (error as Error).message);
      return;
    }

    for (const post of due) {
      try {
        await updatePostStatus(post.id, "draft"); // claim it
        const postId = await publishPagePost(post.content, post.imageUrl ?? undefined);
        await updatePostStatus(post.id, "published", { facebookPostId: postId });
        console.log(`[Scheduler] Published post ${post.id} as ${postId}`);
      } catch (error) {
        const message =
          (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data
            ?.error?.message ?? (error as Error).message;
        await updatePostStatus(post.id, "failed", { lastError: message });
        console.error(`[Scheduler] Post ${post.id} failed:`, message);
      }
    }
  });

  console.log("[Scheduler] Watching for scheduled posts every minute");
}
