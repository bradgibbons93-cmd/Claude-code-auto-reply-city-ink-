export interface ExchangePair {
  customerMessage: string;
  studioReply: string;
}

/**
 * Facebook writes its JSON exports as UTF-8 bytes that have been decoded as
 * Latin-1, so apostrophes arrive as "â€™" and emoji as mojibake. This is the
 * standard round-trip that puts them back.
 */
function fixEncoding(value: string): string {
  try {
    const bytes = Uint8Array.from(value, (character) => character.charCodeAt(0) & 0xff);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return value;
  }
}

interface RawMessage {
  sender_name?: string;
  timestamp_ms?: number;
  content?: string;
}

interface RawThread {
  participants?: Array<{ name?: string }>;
  messages?: RawMessage[];
  title?: string;
}

/** Facebook's own automated lines, which shouldn't be learned from. */
const BOILERPLATE = [
  "replied to an ad",
  "replied to your automated welcome message",
  "you sent an attachment",
  "sent an attachment",
  "lead stage set to",
  "please let us know how we can help you",
];

function isUsable(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (lower.length < 2) return false;
  return !BOILERPLATE.some((phrase) => lower.includes(phrase));
}

/**
 * Turns one exported thread into customer-message/studio-reply pairs.
 *
 * Consecutive messages from the same side are joined, because the studio
 * often sends a thought across two or three bubbles and the reply only
 * makes sense as a whole.
 */
export function parseMessengerExport(json: unknown, studioName: string): ExchangePair[] {
  const thread = json as RawThread;
  if (!Array.isArray(thread?.messages)) return [];

  const studio = studioName.toLowerCase();

  // Exports are newest-first; the conversation only reads correctly in order.
  const ordered = [...thread.messages]
    .filter((message) => typeof message.content === "string" && message.content.trim())
    .sort((a, b) => (a.timestamp_ms ?? 0) - (b.timestamp_ms ?? 0));

  const turns: Array<{ fromStudio: boolean; text: string }> = [];
  for (const message of ordered) {
    const text = fixEncoding(String(message.content));
    if (!isUsable(text)) continue;

    const fromStudio = (message.sender_name ?? "").toLowerCase().includes(studio);
    const previous = turns[turns.length - 1];
    if (previous && previous.fromStudio === fromStudio) {
      previous.text = `${previous.text}\n${text}`;
    } else {
      turns.push({ fromStudio, text });
    }
  }

  const pairs: ExchangePair[] = [];
  for (let index = 0; index < turns.length - 1; index++) {
    const current = turns[index];
    const next = turns[index + 1];
    if (current.fromStudio || !next.fromStudio) continue;

    // Very long blocks are usually a whole conversation glued together and
    // make poor examples; very short ones carry no signal.
    if (current.text.length > 1200 || next.text.length > 1200) continue;
    pairs.push({ customerMessage: current.text, studioReply: next.text });
  }

  return pairs;
}
