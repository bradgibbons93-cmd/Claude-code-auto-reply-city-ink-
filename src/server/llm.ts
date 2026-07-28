import axios from "axios";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const PROVIDER = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();

/**
 * One function, two providers. Set LLM_PROVIDER=anthropic or =openai.
 * "openai" also covers anything OpenAI-compatible (Groq, OpenRouter, Manus)
 * — just point LLM_BASE_URL at it.
 */
export async function invokeLLM(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const maxTokens = opts.maxTokens ?? 400;
  const temperature = opts.temperature ?? 0.6;

  if (PROVIDER === "anthropic") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const rest = messages.filter((m) => m.role !== "system");

    const { data } = await axios.post(
      `${process.env.LLM_BASE_URL || "https://api.anthropic.com"}/v1/messages`,
      {
        model: process.env.LLM_MODEL || "claude-sonnet-5",
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
    `${process.env.LLM_BASE_URL || "https://api.openai.com"}/v1/chat/completions`,
    {
      model: process.env.LLM_MODEL || "gpt-4o-mini",
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

/** Asks for JSON and tolerates the model wrapping it in a code fence. */
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
    // Axios puts the useful part (401 invalid key, 429 out of credit) in the
    // response body, so surface that rather than just "Request failed".
    const err = error as { message?: string; response?: { status?: number; data?: unknown } };
    const detail = err.response
      ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 300)}`
      : err.message || String(error);
    lastError = { message: detail, at: new Date().toISOString() };
    console.error(`[LLM] Call failed — ${detail}`);
    return { data: fallback, ok: false, error: detail };
  }
}
