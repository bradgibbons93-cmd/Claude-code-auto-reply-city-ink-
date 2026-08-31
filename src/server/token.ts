import axios from "axios";

/**
 * Make a pasted token permanent.
 *
 * The Graph API Explorer hands out tokens that die in an hour or two, and it
 * doesn't say so. One of those was pasted into Settings and everything went
 * quiet the following evening: no new messages, no names, no import, and a
 * delivery panel that said the Page wasn't subscribed when really it just
 * couldn't ask. Nothing in the app was wrong and nothing in the app noticed.
 *
 * So the app now does the part that was being asked of a person. Whatever gets
 * pasted — the user token the Explorer shows first, or the Page token behind
 * the dropdown — is exchanged for the long-lived form and then traded for the
 * Page's own token, which Facebook issues without an expiry at all. Getting it
 * wrong is no longer possible, because there is no longer a choice to get
 * wrong.
 */

const GRAPH = process.env.FACEBOOK_GRAPH_URL || "https://graph.facebook.com/v21.0";

export interface TokenReport {
  /** The token to save. The original if nothing better could be had. */
  token: string;
  /** True once we hold a Page token Facebook says has no expiry. */
  permanent: boolean;
  /** When it dies, if it does. */
  expiresAt?: Date;
  /** Page it belongs to, when we learned it on the way through. */
  pageId?: string;
  pageName?: string;
  /** Plain sentence for the settings screen. */
  detail: string;
}

interface Debug {
  type?: string;
  scopes: string[];
  expiresAt?: Date;
  valid: boolean;
}

/** Ask Facebook what a token is, using the app's own credentials. */
export async function describeToken(
  token: string,
  appId: string,
  appSecret: string
): Promise<Debug | undefined> {
  try {
    const { data } = await axios.get(`${GRAPH}/debug_token`, {
      params: { input_token: token, access_token: `${appId}|${appSecret}` },
      timeout: 10000,
    });
    const info = data?.data ?? {};
    // expires_at of 0 is Facebook's way of saying "never".
    const expires = Number(info.expires_at) || 0;
    return {
      type: typeof info.type === "string" ? info.type : undefined,
      scopes: Array.isArray(info.scopes) ? (info.scopes as string[]) : [],
      expiresAt: expires > 0 ? new Date(expires * 1000) : undefined,
      valid: info.is_valid !== false,
    };
  } catch {
    return undefined;
  }
}

/** Short-lived → long-lived. Works on a user token; harmless on others. */
async function extend(token: string, appId: string, appSecret: string): Promise<string | undefined> {
  try {
    const { data } = await axios.get(`${GRAPH}/oauth/access_token`, {
      params: {
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: token,
      },
      timeout: 10000,
    });
    const next = data?.access_token;
    return typeof next === "string" && next ? next : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The Page's own token, asked for with a user token. Derived from a long-lived
 * user token this comes back with no expiry, which is the whole point.
 */
async function pageTokenFrom(
  userToken: string,
  wantedPageId?: string
): Promise<{ token: string; id: string; name?: string } | undefined> {
  try {
    const { data } = await axios.get(`${GRAPH}/me/accounts`, {
      params: { access_token: userToken, limit: 100 },
      timeout: 10000,
    });
    const pages: Array<{ id?: string; name?: string; access_token?: string }> = data?.data ?? [];
    const usable = pages.filter((p) => p.access_token && p.id);
    if (!usable.length) return undefined;
    // Prefer the Page already configured; otherwise there's only one studio.
    const picked = usable.find((p) => p.id === wantedPageId) ?? usable[0];
    return { token: picked.access_token!, id: picked.id!, name: picked.name };
  } catch {
    return undefined;
  }
}

/** "30 Aug at 10:15 pm" — an expiry is only useful if you can read it. */
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
 * Turn whatever was pasted into the longest-lived Page token obtainable.
 *
 * Never throws and never returns nothing: if every upgrade path fails, the
 * original token is handed back with an honest description. A token that
 * works for an hour still beats refusing to save it.
 */
export async function makeTokenLast(
  pasted: string,
  appId: string | null | undefined,
  appSecret: string | null | undefined,
  knownPageId?: string
): Promise<TokenReport> {
  const token = pasted.trim();
  if (!appId || !appSecret) {
    return {
      token,
      permanent: false,
      detail: "Saved. Add the App ID and App secret and I can stop this one expiring.",
    };
  }

  const before = await describeToken(token, appId, appSecret);

  // Already a Page token with no expiry: nothing to do, and say so plainly.
  if (before?.type?.toUpperCase() === "PAGE" && !before.expiresAt && before.valid) {
    return {
      token,
      permanent: true,
      detail: "Saved. This one is a Page token with no expiry — it won't need doing again.",
    };
  }

  // A user token is the easy case, and it's what the Explorer shows first.
  // A Page token that does expire is worth exchanging too: Facebook will
  // often hand back the long-lived form, and when it doesn't we've lost
  // nothing but one request.
  const longLived = (await extend(token, appId, appSecret)) ?? token;
  const page = await pageTokenFrom(longLived, knownPageId);

  if (page) {
    const after = await describeToken(page.token, appId, appSecret);
    if (after?.valid !== false && !after?.expiresAt) {
      return {
        token: page.token,
        permanent: true,
        pageId: page.id,
        pageName: page.name,
        detail:
          `Saved, and swapped for ${page.name ?? "the Page"}'s own token, which has no ` +
          "expiry. You shouldn't have to do this again.",
      };
    }
    if (after?.valid !== false) {
      return {
        token: page.token,
        permanent: false,
        expiresAt: after?.expiresAt,
        pageId: page.id,
        pageName: page.name,
        detail: after?.expiresAt
          ? `Saved as ${page.name ?? "the Page"}'s token, but Facebook still put an expiry on ` +
            `it — ${when(after.expiresAt)}. I'll warn you before it runs out.`
          : `Saved as ${page.name ?? "the Page"}'s token.`,
      };
    }
  }

  // Couldn't improve it. Keep what was pasted and be honest about its life.
  const kept = await describeToken(longLived, appId, appSecret);
  if (kept?.valid === false) {
    return {
      token,
      permanent: false,
      detail:
        "Saved, but Facebook says this token has already expired. Generate a fresh one and " +
        "paste it in — the user token from the Graph API Explorer is fine, I'll do the rest.",
    };
  }
  return {
    token: longLived,
    permanent: false,
    expiresAt: kept?.expiresAt,
    detail: kept?.expiresAt
      ? `Saved, but this one expires ${when(kept.expiresAt)} and I couldn't swap it for a ` +
        "permanent one. Paste the user token from the Graph API Explorer instead and I'll " +
        "trade it for the Page token myself."
      : "Saved.",
  };
}
