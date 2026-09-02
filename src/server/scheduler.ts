import cron from "node-cron";
import { getDuePosts, updatePostStatus } from "./db.js";
import { publishPagePost, importExistingConversations } from "./facebook.js";
import { syncFeed } from "./feed.js";
import { ensureMessengerSubscription } from "./facebook.js";
import { draftForUnanswered } from "./agent.js";
import { notifyOnce, clearAlert } from "./push.js";
import { getFacebookConfig, getWebhookRejections } from "./db.js";
import { describeToken } from "./token.js";

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

  /**
   * Read the studio inbox ourselves, every few minutes.
   *
   * Everything about new messages depended on Facebook pushing them to us,
   * and for two days it didn't: first an expired token, then a subscription
   * Facebook had dropped, then every delivery refused over a stale App
   * secret. Each was a different fault with the same symptom — an inbox that
   * quietly stopped — and no amount of fixing one protects against the next.
   *
   * So the app stops relying on being pushed to. The webhook is still the
   * fast path and nothing about it changes; this is the floor underneath it.
   * Pulling the recent threads is the same call the Import button makes, it
   * is idempotent, and a message already stored is skipped, so the two paths
   * cannot duplicate each other.
   *
   * Only the recent end of the inbox — thirty threads is far more than a
   * studio gets between polls, and asking for everything every three minutes
   * would be rude to an API we depend on.
   */
  cron.schedule("*/3 * * * *", async () => {
    // Two separate jobs, and the second must not depend on the first.
    //
    // It used to: the draft pass ran only when the import had found new
    // messages. But messages normally arrive by webhook and are already
    // stored by the time the import looks, so it finds nothing new and the
    // draft pass was skipped — every time, on the healthy path. The one
    // safety net in the app only ran when it was least needed, and for
    // Instagram, whose import Meta refuses outright, it never ran at all.
    //
    // So anything that reached the inbox without getting a draft — a thread
    // that was muted, a model that fell over, a delivery mid-deploy — was
    // never picked up again by anything.
    try {
      const { conversations, messages } = await importExistingConversations(30);
      if (messages) {
        console.log(`[Inbox] Pulled ${messages} message(s) across ${conversations} thread(s)`);
      }
    } catch (error) {
      console.error("[Inbox] Poll failed:", (error as Error).message);
    }

    // A day, not half an hour.
    //
    // Thirty minutes was right when this was only meant to cover the gap
    // between a webhook arriving and being handled. As the actual safety net
    // it was far too tight: a message that failed to get a draft at ten in
    // the morning — because the thread was muted, or the model fell over —
    // was already out of range by the time anyone noticed, and nothing ever
    // went back for it.
    //
    // Still bounded, because drafting for EVERYTHING unanswered would write
    // replies into threads the studio deliberately left alone weeks ago. Ten
    // at a time, so a quiet backlog trickles onto the board rather than
    // arriving all at once. Cheap when there is nothing to do: one question
    // to the database, and it stops without touching the model.
    try {
      const { drafted, failed } = await draftForUnanswered(10, 24 * 60);
      if (drafted) console.log(`[Inbox] Wrote ${drafted} draft(s) for messages that had none`);
      if (failed) console.warn(`[Inbox] ${failed} draft(s) couldn't be written`);
    } catch (error) {
      console.error("[Inbox] Drafting failed:", (error as Error).message);
    }
  });

  /**
   * The watch on the things that fail silently.
   *
   * Every outage this app has had looked identical from the dashboard: green
   * panels, an inbox that quietly stopped. An expired token, a subscription
   * Facebook had dropped, a stale app secret refusing every delivery. None of
   * them announced themselves and each was found days later, by hand.
   *
   * So the app now goes looking, twice a day, and says so on the phone.
   * notifyOnce holds it to one alert per fault per day — Facebook retries a
   * refused delivery, and forty buzzes an hour is the same as none.
   */
  cron.schedule("13 8,17 * * *", async () => {
    try {
      const config = await getFacebookConfig().catch(() => undefined);
      if (!config?.pageAccessToken || !config.appId || !config.appSecret) return;

      // Asked of Facebook rather than guessed. Everything goes at once when a
      // token dies — no messages, no names, no import, no posting.
      const facts = await describeToken(config.pageAccessToken, config.appId, config.appSecret);
      if (facts && !facts.valid) {
        await notifyOnce("token", {
          title: "City Ink — the Facebook token has expired",
          body: "Nothing is coming in until it's replaced. Settings → Facebook Page.",
          url: "/settings#connections",
          tag: "token",
        });
      } else if (facts?.expiresAt) {
        const daysLeft = (new Date(facts.expiresAt).getTime() - Date.now()) / 86_400_000;
        if (daysLeft < 4) {
          await notifyOnce("token", {
            title: "City Ink — the Facebook token runs out soon",
            body: `About ${Math.max(0, Math.round(daysLeft))} day(s) left. Replacing it now avoids a silent stop.`,
            url: "/settings#connections",
            tag: "token",
          });
        } else {
          await clearAlert("token");
        }
      } else {
        await clearAlert("token");
      }

      // Deliveries being refused means messages ARE arriving and being binned
      // — the opposite of a quiet Page, and invisible without this.
      const rejections = await getWebhookRejections().catch(() => undefined);
      const recent =
        !!rejections?.at && Date.now() - new Date(rejections.at).getTime() < 24 * 3600_000;
      if (recent && (rejections?.count ?? 0) > 5) {
        await notifyOnce("rejections", {
          title: "City Ink — messages are being turned away",
          body: `${rejections?.count} refused. The saved app secret doesn't match the one Meta signs with.`,
          url: "/settings#delivery",
          tag: "rejections",
        });
      } else if (!recent) {
        await clearAlert("rejections");
      }
    } catch (error) {
      console.error("[Watch] Health check failed:", (error as Error).message);
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
        // A scheduled post failing is invisible until someone opens the Posts
        // page — and a batch scheduled a fortnight out could fail every day
        // for a fortnight before anyone looked.
        await notifyOnce(`post-fail`, {
          title: "City Ink — a scheduled post didn't go out",
          body: message.slice(0, 160),
          url: "/posts",
          tag: "post-fail",
        }).catch(() => undefined);
      }
    }
  });

  console.log("[Scheduler] Watching for scheduled posts every minute");
}
