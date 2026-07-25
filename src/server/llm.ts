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
        model: process.env.LLM_MODEL || "claude-sonnet-4-6",
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
export async function invokeLLMJson<T>(messages: ChatMessage[], fallback: T): Promise<T> {
  try {
    const raw = await invokeLLM(messages, { temperature: 0.3 });
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return fallback;
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch (error) {
    console.error("[LLM] JSON parse failed:", (error as Error).message);
    return fallback;
  }
}
