import axios from "axios";
import { desc, sql } from "drizzle-orm";
import { getDb, getFacebookConfig } from "./db.js";
import { feedPosts } from "../drizzle/schema.js";
import { cacheAttachment } from "./attachments.js";

/**
 * The studio's own posts, pulled back out of Facebook and Instagram.
 *
 * Everything is addressed to /me — the token knows which Page it belongs to,
 * and a hand-typed Page ID in a settings box has already broken every read
 * in this app once.
 *
 * Images are downloaded and kept, not linked. Facebook's CDN URLs expire, so
 * a feed of posts from three months ago would otherwise be a wall of blank
 * boxes — which is the one thing a feed cannot be.
 */

const GRAPH = process.env.FACEBOOK_GRAPH_URL || "https://graph.facebook.com/v21.0";

/** How far back a backfill reaches. A few months, as asked. */
const BACKFILL_DAYS = 120;

export interface FeedSyncResult {
  facebook: number;
  instagram: number;
  detail: string;
}

interface GraphPost {
  id: string;
  message?: string;
  caption?: string;
  created_time?: string;
  timestamp?: string;
  permalink_url?: string;
  permalink?: string;
  full_picture?: string;
  media_url?: string;
  thumbnail_url?: string;
  media_type?: string;
  likes?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  like_count?: number;
  comments_count?: number;
}

async function pagedGet(
  url: string,
  params: Record<string, string>,
  maxPages: number,
  since: Date
): Promise<GraphPost[]> {
  const collected: GraphPost[] = [];
  let next: string | undefined = url;
  let query: Record<string, string> | undefined = params;

  for (let page = 0; page < maxPages && next; page += 1) {
    const { data }: { data: { data?: GraphPost[]; paging?: { next?: string } } } =
      await axios.get(next, { params: query, timeout: 15000 });

    const batch = data.data ?? [];
    collected.push(...batch);

    // Stop paging once we're past the window rather than walking years back.
    const oldest = batch[batch.length - 1];
    const oldestAt = oldest?.created_time ?? oldest?.timestamp;
    if (oldestAt && new Date(oldestAt) < since) break;

    next = data.paging?.next;
    query = undefined;
  }

  return collected;
}

async function store(
  posts: GraphPost[],
  source: "facebook" | "instagram",
  since: Date
): Promise<number> {
  const db = await getDb();
  let stored = 0;

  for (const post of posts) {
    const postedAtRaw = post.created_time ?? post.timestamp;
    if (!postedAtRaw) continue;
    const postedAt = new Date(postedAtRaw);
    if (postedAt < since) continue;

    const sourceImage = post.full_picture ?? post.media_url ?? post.thumbnail_url;
    // Keep our own copy — Facebook's link won't work in a month.
    const imagePath = sourceImage
      ? await cacheAttachment(sourceImage, "feed", `${source}_${post.id}`)
      : undefined;

    await db
      .insert(feedPosts)
      .values({
        id: `${source}_${post.id}`,
        source,
        message: post.message ?? post.caption ?? null,
        permalink: post.permalink_url ?? post.permalink ?? null,
        imagePath: imagePath ?? null,
        mediaType: post.media_type ?? null,
        likeCount: post.likes?.summary?.total_count ?? post.like_count ?? 0,
        commentCount: post.comments?.summary?.total_count ?? post.comments_count ?? 0,
        postedAt,
      })
      .onDuplicateKeyUpdate({
        // Counts move; the post doesn't. Never overwrite a stored image with
        // nothing just because a later fetch didn't include one.
        set: {
          likeCount: post.likes?.summary?.total_count ?? post.like_count ?? 0,
          commentCount: post.comments?.summary?.total_count ?? post.comments_count ?? 0,
          fetchedAt: new Date(),
          ...(imagePath ? { imagePath } : {}),
        },
      });
    stored += 1;
  }

  return stored;
}

/**
 * Pull the studio's posts in. Safe to run repeatedly — posts are keyed by
 * their own id, so a refresh updates counts rather than duplicating a feed.
 */
export async function syncFeed(days = BACKFILL_DAYS): Promise<FeedSyncResult> {
  const config = await getFacebookConfig();
  if (!config?.pageAccessToken) {
    return { facebook: 0, instagram: 0, detail: "Facebook isn't connected yet." };
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60_000);
  const token = config.pageAccessToken;
  const problems: string[] = [];
  let facebook = 0;
  let instagram = 0;

  try {
    const posts = await pagedGet(
      `${GRAPH}/me/posts`,
      {
        fields:
          "id,message,created_time,permalink_url,full_picture,likes.summary(true),comments.summary(true)",
        limit: "50",
        access_token: token,
      },
      6,
      since
    );
    facebook = await store(posts, "facebook", since);
  } catch (error) {
    const err = error as { response?: { status?: number; data?: unknown } };
    problems.push(
      err.response
        ? `Facebook posts → HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 200)}`
        : `Facebook posts → ${(error as Error).message}`
    );
  }

  // Instagram only exists here if a business account is linked to the Page.
  // Not having one is normal, not a failure — say so rather than alarming.
  try {
    const { data } = await axios.get(`${GRAPH}/me`, {
      params: { fields: "instagram_business_account", access_token: token },
      timeout: 10000,
    });
    const igId = data?.instagram_business_account?.id;
    if (igId) {
      const media = await pagedGet(
        `${GRAPH}/${igId}/media`,
        {
          fields:
            "id,caption,timestamp,permalink,media_url,thumbnail_url,media_type,like_count,comments_count",
          limit: "50",
          access_token: token,
        },
        6,
        since
      );
      instagram = await store(media, "instagram", since);
    }
  } catch (error) {
    const err = error as { response?: { status?: number } };
    problems.push(
      `Instagram → ${err.response ? `HTTP ${err.response.status}` : (error as Error).message}`
    );
  }

  const total = facebook + instagram;
  const detail = problems.length
    ? `${total} post${total === 1 ? "" : "s"} in. ${explain(problems)}`
    : `${facebook} from Facebook, ${instagram} from Instagram.`;

  console.log(`[Feed] Sync: ${detail}`);
  return { facebook, instagram, detail };
}

/**
 * Say what to do about it, not what the API said.
 *
 * A raw Graph error dumped on screen reads as a broken app. Nearly every
 * failure here is one of a handful of known causes with a known fix, so name
 * the fix. The raw text is still logged for anything genuinely unexpected.
 */
function explain(problems: string[]): string {
  const all = problems.join(" ");

  if (/pages_read_engagement|Page Public Content Access/i.test(all)) {
    return (
      "Facebook won't hand over the Page's posts until the connection includes the " +
      "pages_read_engagement permission. It isn't on the saved token. Regenerate the " +
      "Page access token in the Meta app dashboard with pages_read_engagement ticked, " +
      "paste it into the Facebook Page box above, and refresh. Messages are unaffected — " +
      "they use a different permission and keep working either way."
    );
  }

  if (/Session has expired|Error validating access token|OAuthException/i.test(all)) {
    return (
      "The saved Page access token has expired. Generate a fresh one in the Meta app " +
      "dashboard and paste it into the Facebook Page box above."
    );
  }

  if (/instagram/i.test(all) && problems.length === 1) {
    return "No Instagram business account is linked to this Page, so there's nothing to pull from Instagram.";
  }

  return problems.join(" · ");
}

export async function listFeed(limit = 60) {
  const db = await getDb();
  return db.select().from(feedPosts).orderBy(desc(feedPosts.postedAt)).limit(limit);
}

export async function countFeed(): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ count: sql<number>`COUNT(*)` }).from(feedPosts);
  return Number(row?.count ?? 0);
}
