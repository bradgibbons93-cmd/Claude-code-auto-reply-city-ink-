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

/** What Facebook says about the token we actually have saved. */
interface TokenFacts {
  /** "PAGE" or "USER" — reading Page posts needs a Page one. */
  type?: string;
  scopes: string[];
  issuedAt?: Date;
  valid: boolean;
}

/**
 * Ask Facebook what the saved token really is.
 *
 * Guessing at this has already cost an evening. The settings box only ever
 * says a token is saved, never which one, so a paste that silently didn't
 * take looks identical to a permission Facebook refused to grant. debug_token
 * distinguishes the two, and it's the app's own credentials doing the asking,
 * so it works even when the token itself can't read anything.
 */
async function inspectToken(
  token: string,
  appId?: string | null,
  appSecret?: string | null
): Promise<TokenFacts | undefined> {
  if (!appId || !appSecret) return undefined;
  try {
    const { data } = await axios.get(`${GRAPH}/debug_token`, {
      params: { input_token: token, access_token: `${appId}|${appSecret}` },
      timeout: 10000,
    });
    const info = data?.data ?? {};
    return {
      type: typeof info.type === "string" ? info.type : undefined,
      scopes: Array.isArray(info.scopes) ? (info.scopes as string[]) : [],
      issuedAt: info.issued_at ? new Date(info.issued_at * 1000) : undefined,
      valid: info.is_valid !== false,
    };
  } catch {
    return undefined;
  }
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

  // /me/posts is the obvious edge and the wrong one. With a valid Page token
  // carrying pages_read_engagement it still answers "(#10) requires
  // pages_read_engagement or Page Public Content Access" — the error for
  // reading a Page you don't manage, which is not what's happening. The
  // documented edge for a Page's own posts is published_posts; feed is the
  // older equivalent and includes other people's posts to the Page. Try them
  // in that order rather than sending anyone back to the app dashboard for a
  // permission they already granted.
  const POST_EDGES = ["me/published_posts", "me/feed", "me/posts"];
  for (const edge of POST_EDGES) {
    try {
      const posts = await pagedGet(
        `${GRAPH}/${edge}`,
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
      // An edge that worked settles it — the ones tried before it were
      // attempts, not faults, and must not be reported as though they were.
      problems.length = 0;
      if (edge !== POST_EDGES[0]) console.log(`[Feed] Read the Page's posts from /${edge}`);
      break;
    } catch (error) {
      const err = error as { response?: { status?: number; data?: unknown } };
      problems.push(
        err.response
          ? `/${edge} → HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 400)}`
          : `/${edge} → ${(error as Error).message}`
      );
    }
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
  if (!problems.length) {
    const detail = `${facebook} from Facebook, ${instagram} from Instagram.`;
    console.log(`[Feed] Sync: ${detail}`);
    return { facebook, instagram, detail };
  }

  // Log what Facebook actually said before turning it into advice. An earlier
  // version kept only the advice, so a wrong guess was indistinguishable from
  // a right one and the logs couldn't settle it.
  console.warn(`[Feed] Sync failed. Graph said: ${problems.join(" · ")}`);

  const facts = await inspectToken(token, config.appId, config.appSecret);
  if (facts) {
    console.warn(
      `[Feed] Saved token: type=${facts.type ?? "unknown"} valid=${facts.valid} ` +
        `issued=${facts.issuedAt?.toISOString() ?? "unknown"} scopes=${facts.scopes.join(",") || "none"}`
    );
  }

  const detail = `${total} post${total === 1 ? "" : "s"} in. ${explain(problems, facts)}`;
  return { facebook, instagram, detail };
}

/** "on 30 Aug at 2:14 pm" — a token's age is how you spot the wrong one. */
function when(at: Date): string {
  return at.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Australia/Melbourne",
  });
}

/**
 * Say what to do about it, not what the API said.
 *
 * A raw Graph error dumped on screen reads as a broken app. Nearly every
 * failure here is one of a handful of known causes with a known fix, so name
 * the fix. The raw text is still logged for anything genuinely unexpected.
 *
 * Where the fix depends on what the saved token is, check it rather than
 * assume: telling someone to add a permission their token already carries
 * sends them round the same loop a second time.
 */
function explain(problems: string[], facts?: TokenFacts): string {
  const all = problems.join(" ");

  if (/pages_read_engagement|Page Public Content Access/i.test(all)) {
    // A User token reads the person's own posts, not the Page's, and no
    // permission will change that. It's the easiest wrong token to paste,
    // because it's the one the Graph Explorer shows you first.
    if (facts?.type && facts.type.toUpperCase() !== "PAGE") {
      return (
        `The saved token is a ${facts.type.toLowerCase()} token, not the Page token, so ` +
        "Facebook is looking for your own posts rather than the studio's. In the Graph API " +
        "Explorer, switch the \"User or Page\" dropdown to City Ink Tattoo Geelong, copy the " +
        "token that appears, and paste that into the Facebook Page box above."
      );
    }

    if (facts && !facts.scopes.includes("pages_read_engagement")) {
      const age = facts.issuedAt ? ` The one saved was issued ${when(facts.issuedAt)}.` : "";
      return (
        "Facebook won't hand over the Page's posts until the connection includes the " +
        `pages_read_engagement permission, and the saved token doesn't carry it.${age} ` +
        "Regenerate the Page access token in the Meta app dashboard with pages_read_engagement " +
        "ticked, paste it into the Facebook Page box above, and refresh. Messages are " +
        "unaffected — they use a different permission and keep working either way."
      );
    }

    // The token has the permission and Facebook refuses anyway. A permission
    // lives in two places: on the token, where the person granted it, and on
    // the app, where Meta decides whether the app may use it at all. Only the
    // first of those is fixed by generating a new token, which is why doing so
    // changes nothing here. Nothing on this screen can fix the second.
    if (facts?.scopes.includes("pages_read_engagement")) {
      return (
        "Nothing is wrong with the connection — the saved token is the Page token, it's " +
        "valid, and pages_read_engagement is on it. Generating another one won't change " +
        "this. The permission also has to be switched on for the app itself, and that's " +
        "what's missing: in the Meta app dashboard under App Review → Permissions and " +
        "Features, find pages_read_engagement and request access for it. Until that's " +
        "granted the Live feed stays empty. Messages are completely unaffected — they use " +
        "a different permission and are working."
      );
    }

    return (
      "Facebook won't hand over the Page's posts until the connection includes the " +
      "pages_read_engagement permission. Regenerate the Page access token in the Meta app " +
      "dashboard with pages_read_engagement ticked, paste it into the Facebook Page box " +
      "above, and refresh. Messages are unaffected — they use a different permission and " +
      "keep working either way."
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
