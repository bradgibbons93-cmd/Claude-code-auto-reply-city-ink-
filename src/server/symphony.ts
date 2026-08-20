import axios from "axios";

/**
 * Symphony is Brad's own team of business agents. It can schedule, contact
 * people, chase things up and report back — as him. Anything sent here is
 * treated as coming from Brad and carries his authority, so this module is
 * deliberately narrow: it notifies and it asks, and the only thing that
 * decides what gets said is code in this repo.
 *
 * The credential is an environment variable, never a database row and never
 * anything the dashboard can read back. Same reasoning as LLM_API_KEY: the
 * browser has no business holding a token that can act as the studio owner.
 */

const DEFAULT_BASE_URL = "https://symphony.wix.com/individuals-chat/poc";

/** Keeping one session id means replies stay in a single thread on Symphony's side. */
const DEFAULT_SESSION_ID = "city-ink-agent";

/** Symphony's own turns can take a minute or two, so the doc's ~2 min ceiling stands. */
const REPLY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 3_000;

/**
 * Read at call time rather than at import, so /health and the Settings test
 * always report the config the next real call will use.
 */
export function symphonyBaseUrl(): string {
  return (process.env.SYMPHONY_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function symphonySessionId(): string {
  return process.env.SYMPHONY_SESSION_ID || DEFAULT_SESSION_ID;
}

export function symphonyConfigured(): boolean {
  return !!process.env.SYMPHONY_API_TOKEN;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.SYMPHONY_API_TOKEN || ""}`,
    "Content-Type": "application/json",
  };
}

/** The last thing that went wrong, so /health can report it without digging through logs. */
let lastError: { message: string; at: string } | null = null;
export function getLastSymphonyError() {
  return lastError;
}

function noteError(message: string): string {
  lastError = { message, at: new Date().toISOString() };
  console.error(`[Symphony] ${message}`);
  return message;
}

/**
 * Turns a transport failure into the one sentence that says what to fix.
 * Same intent as the LLM diagnosis: a revoked token, a typo'd URL and a
 * service outage all look identical from the dashboard otherwise.
 */
function diagnose(error: unknown): string {
  const err = error as {
    code?: string;
    message?: string;
    response?: { status?: number; data?: unknown };
  };
  const status = err.response?.status;
  const body = err.response?.data ? JSON.stringify(err.response.data) : "";
  const baseUrl = symphonyBaseUrl();

  if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") {
    return `Couldn't find ${baseUrl}. Check SYMPHONY_BASE_URL for a typo.`;
  }
  if (err.code === "ECONNREFUSED") {
    return `Nothing answered at ${baseUrl}. Check SYMPHONY_BASE_URL.`;
  }
  if (err.code === "ECONNABORTED" || /timeout/i.test(err.message || "")) {
    return "Symphony didn't answer in time. Usually temporary — try again.";
  }
  if (status === 401 || status === 403) {
    return "Symphony rejected the token. It may have been revoked — issue a new one in Symphony → Settings → Connections and update SYMPHONY_API_TOKEN.";
  }
  if (status === 404) {
    return `Symphony returned 404 for ${baseUrl}. Check SYMPHONY_BASE_URL points at the agent API.`;
  }
  if (status === 429) {
    return "Symphony is rate limiting. Wait a minute and try again.";
  }
  if (status) return `Symphony returned HTTP ${status}: ${body.slice(0, 200)}`;
  return err.message || String(error);
}

export interface SymphonyResult {
  ok: boolean;
  /** Symphony's answer, when one arrived. */
  reply?: string;
  /** Kept so a slow turn can be followed up on later. */
  conversationId?: string;
  /** True when the message landed but Symphony was still working when we stopped waiting. */
  pending?: boolean;
  error?: string;
}

interface AskResponse {
  reply?: string;
  status?: string;
  conversationId?: string;
}

/**
 * Sends one message to Symphony.
 *
 * Symphony answers in one of two ways: straight away with a `reply`, or with
 * `status: "accepted"` and a conversation to poll. `waitForReply: false` is
 * for notifications — the message has been delivered at that point, and
 * holding a Facebook webhook open for two minutes waiting on a reply nobody
 * reads would be worse than useless.
 *
 * Never throws. Callers get `ok: false` and a sentence explaining why, the
 * same contract invokeLLMJson uses, because a Symphony outage must not stop
 * a customer being answered.
 */
export async function askSymphony(
  message: string,
  opts: { waitForReply?: boolean; sessionId?: string } = {}
): Promise<SymphonyResult> {
  const waitForReply = opts.waitForReply ?? true;

  if (!symphonyConfigured()) {
    return {
      ok: false,
      error: noteError("SYMPHONY_API_TOKEN is not set — nothing was sent to Symphony."),
    };
  }

  let accepted: AskResponse;
  try {
    const { data } = await axios.post<AskResponse>(
      `${symphonyBaseUrl()}/agent/ask`,
      { message, sessionId: opts.sessionId || symphonySessionId() },
      { headers: authHeaders(), timeout: 30_000 }
    );
    accepted = data || {};
  } catch (error) {
    return { ok: false, error: noteError(diagnose(error)) };
  }

  lastError = null;

  // Answered on the spot — nothing to poll for.
  if (accepted.reply) {
    return { ok: true, reply: accepted.reply, conversationId: accepted.conversationId };
  }

  const conversationId = accepted.conversationId;
  if (!conversationId) {
    return {
      ok: false,
      error: noteError("Symphony accepted the message but returned no conversationId to follow up on."),
    };
  }

  // Delivered. For a notification that is the whole job.
  if (!waitForReply) {
    return { ok: true, conversationId, pending: true };
  }

  return pollForReply(conversationId);
}

/** Polls /agent/reply until Symphony has answered, or until the ceiling is hit. */
async function pollForReply(conversationId: string): Promise<SymphonyResult> {
  const deadline = Date.now() + REPLY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    let data: AskResponse;
    try {
      ({ data } = await axios.post<AskResponse>(
        `${symphonyBaseUrl()}/agent/reply`,
        { conversationId },
        { headers: authHeaders(), timeout: 30_000 }
      ));
    } catch (error) {
      return { ok: false, conversationId, error: noteError(diagnose(error)) };
    }

    if (data?.status === "answered" && data.reply) {
      lastError = null;
      return { ok: true, reply: data.reply, conversationId };
    }
  }

  // Not a failure — Symphony has the message and is still working on it.
  return {
    ok: true,
    conversationId,
    pending: true,
    error: "Symphony is still working on this one. The message went through — check Symphony for the answer.",
  };
}

/**
 * Notifies Symphony about something that happened in the studio.
 *
 * Phrased as a report rather than an instruction, and never waits for a
 * reply. A message here carries Brad's authority to act, so anything this
 * codebase sends unprompted says plainly that it is for information — the
 * agent decides what to tell Symphony, it does not decide what Symphony
 * should go and do.
 */
export async function notifySymphony(subject: string, body: string): Promise<SymphonyResult> {
  const message = [
    `For Brad's information — from the City Ink Messenger agent. ${subject}`,
    "",
    body,
    "",
    "This is a notification only. Take no action unless Brad asks you to.",
  ].join("\n");

  return askSymphony(message, { waitForReply: false });
}

export interface SymphonyTestResult {
  ok: boolean;
  baseUrl: string;
  sessionId: string;
  tokenSet: boolean;
  /** Plain English: what happened and what to change. */
  detail: string;
  /** What Symphony actually replied, when it worked. */
  sample?: string;
}

/**
 * Makes one real, tiny call, so the dashboard can prove the connection works
 * before a booking is riding on it. Deliberately asks Symphony to do nothing.
 */
export async function testSymphony(): Promise<SymphonyTestResult> {
  const base = {
    baseUrl: symphonyBaseUrl(),
    sessionId: symphonySessionId(),
    tokenSet: symphonyConfigured(),
  };

  if (!symphonyConfigured()) {
    return { ...base, ok: false, detail: "No SYMPHONY_API_TOKEN is set in Railway yet." };
  }

  const result = await askSymphony(
    "Connection test from the City Ink dashboard. Please reply with just: ok. Take no other action.",
    { waitForReply: true }
  );

  if (result.ok && result.reply) {
    return { ...base, ok: true, detail: "Connected — Symphony is answering.", sample: result.reply.trim() };
  }
  if (result.ok && result.pending) {
    return {
      ...base,
      ok: true,
      detail: "Connected — Symphony took the message but hadn't answered within two minutes.",
    };
  }
  return { ...base, ok: false, detail: result.error || "Symphony didn't answer." };
}
