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
  const maxTokens = opts.maxTokens ?? 400;
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

    const block = data?.content?.find((b: { type: string }) => b.type === "text");
    if (!block?.text) throw new Error("Empty LLM response");
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
  return err.message || String(error);
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

  try {
    const reply = await invokeLLM([{ role: "user", content: "Reply with just the word: ok" }], {
      maxTokens: 16,
      temperature: 0,
    });
    lastError = null;
    return { ...base, ok: true, detail: "Working — the agent can draft replies.", sample: reply.trim() };
  } catch (error) {
    const detail = diagnose(error, model, baseUrl);
    lastError = { message: detail, at: new Date().toISOString() };
    console.error(`[LLM] Test failed — ${detail}`);
    return { ...base, ok: false, detail };
  }
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
  fallback: T
): Promise<LlmResult<T>> {
  if (!process.env.LLM_API_KEY) {
    const message = "LLM_API_KEY is not set — no reply can be generated.";
    lastError = { message, at: new Date().toISOString() };
    console.error(`[LLM] ${message}`);
    return { data: fallback, ok: false, error: message };
  }

  try {
    const raw = await invokeLLM(messages, { temperature: 0.3 });
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) {
      const message = "Model replied without JSON.";
      lastError = { message, at: new Date().toISOString() };
      console.error(`[LLM] ${message} Raw: ${raw.slice(0, 200)}`);
      return { data: fallback, ok: false, error: message };
    }
    lastError = null;
    return { data: JSON.parse(cleaned.slice(start, end + 1)) as T, ok: true };
  } catch (error) {
    // Same diagnosis the Settings test uses, so a failure mid-conversation
    // and a failure on the test button read identically.
    const detail = diagnose(error, llmModel(), llmBaseUrl());
    lastError = { message: detail, at: new Date().toISOString() };
    console.error(`[LLM] Call failed — ${detail}`);
    return { data: fallback, ok: false, error: detail };
  }
}
