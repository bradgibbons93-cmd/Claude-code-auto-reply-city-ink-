import axios from "axios";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Read at call time rather than at import, so what /health and the Settings
 * test report is always the config the next real call will use.
 */
export function llmProvider(): string {
  return (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
}

export function llmBaseUrl(): string {
  if (process.env.LLM_BASE_URL) return process.env.LLM_BASE_URL.replace(/\/+$/, "");
  return llmProvider() === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com";
}

export function llmModel(): string {
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL;
  return llmProvider() === "anthropic" ? "claude-sonnet-5" : "gpt-4o-mini";
}

/**
 * Providers disagree about whether the version belongs in the base URL:
 * OpenRouter hands you one ending in /api/v1 and Groq one ending in
 * /openai/v1, while OpenAI's and Anthropic's are bare. Appending blindly
 * produces /v1/v1/chat/completions and a 404 that reads like a bad key, so
 * only add the part that isn't already there.
 */
function endpoint(suffix: string): string {
  const base = llmBaseUrl();
  const alreadyVersioned = /\/v\d+[a-z]*$|\/openai$/i.test(base);
  return alreadyVersioned ? `${base}/${suffix}` : `${base}/v1/${suffix}`;
}

/**
 * One function, two providers. Set LLM_PROVIDER=anthropic or =openai.
 * "openai" also covers anything OpenAI-compatible (OpenRouter, Groq, Together,
 * Google's compatibility endpoint) — just point LLM_BASE_URL at it.
 */
export async function invokeLLM(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  // 400 was far too tight for a current model. A Claude 4.6-or-later model
  // may reason before it answers, and that reasoning is spent out of the same
  // budget — so a small ceiling can be used up entirely before a single word
  // of the actual reply is written, and what comes back has no text in it at
  // all. That is what "Empty LLM response" was, eight times in one minute.
  const maxTokens = opts.maxTokens ?? 1024;
  const temperature = opts.temperature ?? 0.6;

  if (llmProvider() === "anthropic") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const rest = messages.filter((m) => m.role !== "system");

    const { data } = await axios.post(
      endpoint("messages"),
      {
        model: llmModel(),
        max_tokens: maxTokens,
        temperature,
        system: system || undefined,
        messages: rest.map((m) => ({ role: m.role, content: m.content })),
      },
      {
        headers: {
          "x-api-key": process.env.LLM_API_KEY || "",
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        timeout: 20000,
      }
    );

    const blocks: { type: string; text?: string }[] = data?.content ?? [];
    const block = blocks.find((b) => b.type === "text");
    if (!block?.text) {
      // Say which of the two this is. "Empty LLM response" was true and
      // useless: it read as the model being unreachable when in fact it had
      // answered, and had simply run out of room before the answer began.
      const kinds = blocks.map((b) => b.type).join(", ") || "nothing at all";
      const stop = data?.stop_reason ?? "no stop_reason";
      throw new Error(
        stop === "max_tokens"
          ? `The model used its whole ${maxTokens}-token budget before writing any reply (it returned ${kinds}). It needs more room.`
          : `The model returned no text — ${kinds}, stop_reason ${stop}.`
      );
    }
    return block.text as string;
  }

  const { data } = await axios.post(
    endpoint("chat/completions"),
    {
      model: llmModel(),
      messages,
      max_tokens: maxTokens,
      temperature,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LLM_API_KEY || ""}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content) throw new Error("Empty LLM response");
  return content;
}

export interface LlmTestResult {
  ok: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  /** Plain English: what happened and what to change. */
  detail: string;
  /** What the model actually replied, when it worked. */
  sample?: string;
}

/**
 * Turns a provider's failure into the one sentence that says what to fix.
 * Every dead end on this project has looked identical from the dashboard —
 * a wrong model name, a spent balance and a typo'd URL all surfaced as the
 * same silence — so the whole point here is to tell them apart.
 */
/**
 * Whether the saved key is for a different provider than the one configured.
 *
 * Switching provider is two changes — the endpoint and the key — and doing
 * only the first leaves a valid key being offered to a company that has
 * never issued it. Anthropic keys start `sk-ant-`, OpenRouter's `sk-or-`,
 * OpenAI's `sk-` with neither prefix. Unknown shapes say nothing rather than
 * guess, because a self-hosted or proxied endpoint can use any format.
 */
function keyBelongsElsewhere(): string | null {
  const key = (process.env.LLM_API_KEY || "").trim();
  if (!key) return null;
  const provider = llmProvider();

  if (provider === "anthropic" && !key.startsWith("sk-ant-")) {
    const looksLike = key.startsWith("sk-or-") ? "OpenRouter" : "another provider";
    return (
      `That key is for ${looksLike}, not Anthropic — Anthropic's own keys start "sk-ant-". ` +
      "Create one at console.anthropic.com → API keys and put it in LLM_API_KEY."
    );
  }
  if (provider !== "anthropic" && key.startsWith("sk-ant-")) {
    return (
      "That is an Anthropic key, but the app is pointed at a different provider. " +
      "Either set LLM_PROVIDER to anthropic, or paste the key for the provider in LLM_BASE_URL."
    );
  }
  return null;
}

function diagnose(error: unknown, model: string, baseUrl: string): string {
  const err = error as {
    code?: string;
    message?: string;
    response?: { status?: number; data?: unknown };
  };
  const status = err.response?.status;
  const body = err.response?.data ? JSON.stringify(err.response.data) : "";

  if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") {
    return `Couldn't find ${baseUrl}. Check LLM_BASE_URL for a typo.`;
  }
  if (err.code === "ECONNREFUSED") {
    return `Nothing answered at ${baseUrl}. Check LLM_BASE_URL.`;
  }
  if (err.code === "ECONNABORTED" || /timeout/i.test(err.message || "")) {
    return "The provider didn't answer in time. Usually temporary — try again.";
  }
  if (status === 401 || status === 403) {
    // A key from the wrong provider is the commonest way to land here, and
    // "check it was copied in full" sends someone hunting for a typo in a
    // key that is perfectly intact and simply belongs somewhere else. The
    // prefixes are unambiguous, so say which one it is.
    const mismatch = keyBelongsElsewhere();
    if (mismatch) return mismatch;
    return "The provider rejected the key. Check LLM_API_KEY was copied in full, with no spaces.";
  }
  if (status === 402) {
    return "The key works, but the account has no credit. Top it up with the provider.";
  }
  if (status === 429) {
    return "Rate limited, or the free allowance is used up for now. Wait a minute and try again.";
  }
  if (status === 404 || (status === 400 && /model/i.test(body))) {
    return `The provider doesn't recognise the model "${model}". Copy the exact name from its model list into LLM_MODEL.`;
  }
  if (status) return `The provider returned HTTP ${status}: ${body.slice(0, 200)}`;
  // A JSON syntax error means the provider answered fine and we couldn't read
  // it — nothing to do with keys, credit or model names. Saying so stops the
  // next person tearing apart the Railway variables over a token limit.
  if (error instanceof SyntaxError) {
    return /cut off/i.test(err.message || "")
      ? `The model ran out of room before finishing its answer, and too little arrived to salvage. Raise the token limit for drafting. (${err.message})`
      : `The model answered, but not in readable JSON. Nothing to do with the key — it's the wording of the reply. (${err.message})`;
  }
  return err.message || String(error);
}

/**
 * Closes a JSON object that stopped mid-sentence because the model ran out of
 * tokens. The reply itself is usually finished by then and only the extra
 * wordings are half-written, so throwing the whole thing away loses a good
 * draft over a missing bracket. Anything still open is shut in the right
 * order; a trailing half-written element is dropped rather than guessed at.
 */
function closeTruncatedJson(text: string): string | undefined {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  // Where the last complete element ended, so a half-written one can be cut.
  let lastSafe = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      stack.pop();
      lastSafe = i;
    } else if (ch === ",") lastSafe = i - 1;
  }

  if (!stack.length && !inString) return undefined; // Not truncated — a real syntax error.
  // Cut back to the last thing that finished, then close what's still open.
  const body = lastSafe >= 0 ? text.slice(0, lastSafe + 1) : text;
  const reclosed: string[] = [];
  let depth = 0;
  let str = false;
  let esc = false;
  for (const ch of body) {
    if (esc) { esc = false; continue; }
    if (str) {
      if (ch === "\\") esc = true;
      else if (ch === '"') str = false;
      continue;
    }
    if (ch === '"') str = true;
    else if (ch === "{") { reclosed[depth++] = "}"; }
    else if (ch === "[") { reclosed[depth++] = "]"; }
    else if (ch === "}" || ch === "]") depth--;
  }
  if (depth <= 0) return undefined;
  return body + reclosed.slice(0, depth).reverse().join("");
}

/**
 * Makes one real, tiny call so the dashboard can prove the agent can think
 * before a customer is waiting on it.
 */
export async function testLlm(): Promise<LlmTestResult> {
  const provider = llmProvider();
  const model = llmModel();
  const baseUrl = llmBaseUrl();
  const base = { provider, model, baseUrl };

  if (!process.env.LLM_API_KEY) {
    return { ...base, ok: false, detail: "No LLM_API_KEY is set in Railway yet." };
  }

  // Down the same road a real draft takes — a reply plus alternatives, read
  // back the same way, salvaged the same way. A 16-token "say ok" ping passed
  // happily while every actual draft was failing on a truncated answer, so
  // the one button meant to catch that reported everything fine.
  const { data, ok, error } = await invokeLLMJson<{ reply?: string }>(
    [
      {
        role: "user",
        content:
          'A customer asks "how much for a small forearm piece?". Reply with JSON only: {"reply": "...", "alternatives": [{"label": "...", "text": "..."}, {"label": "...", "text": "..."}], "intent": "pricing"}',
      },
    ],
    {}
  );

  if (!ok) {
    const detail = error || "The agent couldn't get a usable draft back.";
    console.error(`[LLM] Test failed — ${detail}`);
    return { ...base, ok: false, detail };
  }
  return {
    ...base,
    ok: true,
    detail: "Working — the agent can draft replies.",
    sample: (data.reply || "").trim().slice(0, 300),
  };
}

/** The last thing that went wrong, so /health can report it without logs. */
let lastError: { message: string; at: string } | null = null;
export function getLastLlmError() {
  return lastError;
}

export interface LlmResult<T> {
  data: T;
  /** False when the model never answered — the caller got the fallback. */
  ok: boolean;
  error?: string;
}

/**
 * Asks for JSON and tolerates the model wrapping it in a code fence.
 *
 * Returns `ok: false` rather than throwing, but callers must not treat a
 * failed call as a considered answer: a missing API key used to surface as
 * "one of the team will come back to you shortly" on every single message,
 * which reads like a decision the agent made instead of the outage it is.
 */
export async function invokeLLMJson<T>(
  messages: ChatMessage[],
  fallback: T,
  opts: { maxTokens?: number } = {}
): Promise<LlmResult<T>> {
  if (!process.env.LLM_API_KEY) {
    const message = "LLM_API_KEY is not set — no reply can be generated.";
    lastError = { message, at: new Date().toISOString() };
    console.error(`[LLM] ${message}`);
    return { data: fallback, ok: false, error: message };
  }

  try {
    // Room to actually finish. A draft plus two alternatives plus the
    // extracted booking fields does not fit in the 400 the plain call
    // defaults to — the answer came back cut off mid-array, failed to parse,
    // and every enquiry landed on the board with no draft at all.
    // Room for the model to think AND answer. A draft, two alternatives and
    // the extracted booking fields is not a big answer, but on a model that
    // reasons first the reasoning comes out of the same allowance — at 1500
    // it was being spent before the reply started, and every enquiry landed
    // on the board with no draft at all.
    const budget = opts.maxTokens ?? 4000;
    let raw: string;
    try {
      raw = await invokeLLM(messages, { temperature: 0.3, maxTokens: budget });
    } catch (firstError) {
      // Out of room is the one failure worth spending a second call on;
      // everything else would fail identically however much room it had.
      if (!/whole \d+-token budget/.test((firstError as Error).message)) throw firstError;
      console.warn(`[LLM] Ran out of room at ${budget} tokens — asking again with ${budget * 2}`);
      raw = await invokeLLM(messages, { temperature: 0.3, maxTokens: budget * 2 });
    }
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    if (start === -1) {
      const message = "Model replied without JSON.";
      lastError = { message, at: new Date().toISOString() };
      console.error(`[LLM] ${message} Raw: ${raw.slice(0, 200)}`);
      return { data: fallback, ok: false, error: message };
    }
    const end = cleaned.lastIndexOf("}");
    const body = cleaned.slice(start, end > start ? end + 1 : undefined);

    try {
      lastError = null;
      return { data: JSON.parse(body) as T, ok: true };
    } catch (parseError) {
      // Cut off rather than malformed: keep what did arrive. The reply is
      // written before the alternatives, so a truncated answer still holds
      // the draft that matters.
      const repaired = closeTruncatedJson(body);
      if (repaired) {
        try {
          const data = JSON.parse(repaired) as T;
          console.warn("[LLM] Answer was cut short — salvaged the part that arrived");
          lastError = null;
          return { data, ok: true };
        } catch {
          /* fall through to the normal failure below */
        }
      }
      // `repaired` being undefined means nothing was left open — the answer
      // arrived whole and is genuinely malformed, which is a different fault
      // from running out of room, and worth not guessing about.
      throw new SyntaxError(
        `${repaired ? "cut off mid-answer" : "malformed"} — ${(parseError as Error).message}`
      );
    }
  } catch (error) {
    // Same diagnosis the Settings test uses, so a failure mid-conversation
    // and a failure on the test button read identically.
    const detail = diagnose(error, llmModel(), llmBaseUrl());
    lastError = { message: detail, at: new Date().toISOString() };
    console.error(`[LLM] Call failed — ${detail}`);
    return { data: fallback, ok: false, error: detail };
  }
}
