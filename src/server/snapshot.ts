import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import satori from "satori";
import sharp from "sharp";

/**
 * A picture of a conversation, the way it looks on a phone.
 *
 * Brad's instruction: when a reply says the studio will check with Mim, "take
 * a screenshot and send Mim an email". There is no phone to screenshot on a
 * server, so this draws one — the bubbles, the photos the customer sent, the
 * emoji — as a PNG that can go in an email.
 *
 * Satori lays it out and turns every letter into a shape, and sharp paints
 * the result. That matters on Railway: the container has no fonts installed,
 * so anything that asks the system for a typeface draws blank boxes. The font
 * and the emoji come from npm packages instead, read off disk here.
 */

const require = createRequire(import.meta.url);

export interface SnapshotTurn {
  from: "customer" | "studio";
  text: string;
  at: Date | string | null;
  /** Bytes of the photos that came with this message, already read. */
  photos?: Array<{ bytes: Buffer; contentType: string }>;
  /** Photos we never kept — drawn as a placeholder tile, not a broken image. */
  missingPhotos?: number;
}

export interface SnapshotInput {
  customerName: string;
  platform: "facebook" | "instagram";
  studioName: string;
  turns: SnapshotTurn[];
  /** Tag drawn under the last studio message, e.g. "Sent · waiting on Mim". */
  footnote?: string;
  timeZone?: string;
}

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node => ({
  type,
  props: { style, children, ...extra },
});

let fonts: Array<{ name: string; data: Buffer; weight: 400 | 600 | 700; style: "normal" }> | undefined;
async function loadFonts() {
  if (fonts) return fonts;
  const dir = path.dirname(require.resolve("@fontsource/inter/package.json"));
  const file = (n: string) => readFile(path.join(dir, "files", n));
  const [r, rx, s, sx] = await Promise.all([
    file("inter-latin-400-normal.woff"),
    file("inter-latin-ext-400-normal.woff"),
    file("inter-latin-600-normal.woff"),
    file("inter-latin-ext-600-normal.woff"),
  ]);
  fonts = [
    { name: "Inter", data: r, weight: 400, style: "normal" },
    { name: "Inter", data: rx, weight: 400, style: "normal" },
    { name: "Inter", data: s, weight: 600, style: "normal" },
    { name: "Inter", data: sx, weight: 600, style: "normal" },
  ];
  return fonts;
}

// Twemoji names its files by code point, dropping the variation selector
// unless the emoji is a joined sequence — the same rule @vercel/og uses.
const emojiCache = new Map<string, string>();
async function emojiDataUri(segment: string): Promise<string | undefined> {
  const code = [...(segment.includes("‍") ? segment : segment.replace(/️/g, ""))]
    .map((c) => c.codePointAt(0)!.toString(16))
    .join("-");
  if (emojiCache.has(code)) return emojiCache.get(code);
  try {
    const dir = path.dirname(require.resolve("@twemoji/svg/package.json"));
    const svg = await readFile(path.join(dir, `${code}.svg`));
    const uri = `data:image/svg+xml;base64,${svg.toString("base64")}`;
    emojiCache.set(code, uri);
    return uri;
  } catch {
    emojiCache.set(code, "");
    return undefined;
  }
}

async function photoTile(bytes: Buffer): Promise<{ src: string; width: number; height: number } | undefined> {
  try {
    // Drawn 190 wide at twice the resolution, so it's sharp on a phone.
    const out = await sharp(bytes).rotate().resize({ width: 380, height: 520, fit: "inside", withoutEnlargement: false }).jpeg({ quality: 78 }).toBuffer({ resolveWithObject: true });
    return {
      src: `data:image/jpeg;base64,${out.data.toString("base64")}`,
      width: Math.round(out.info.width / 2),
      height: Math.round(out.info.height / 2),
    };
  } catch {
    return undefined;
  }
}

function clock(at: Date | string | null, timeZone: string): string {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const day = (x: Date) => x.toLocaleDateString("en-AU", { timeZone, year: "numeric", month: "numeric", day: "numeric" });
  const time = d.toLocaleTimeString("en-AU", { timeZone, hour: "numeric", minute: "2-digit" }).replace(/\s/g, " ");
  const now = new Date();
  if (day(d) === day(now)) return `Today ${time}`;
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return `Yesterday ${time}`;
  return `${d.toLocaleDateString("en-AU", { timeZone, weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

const WIDTH = 390;

/** Draws the thread and returns a PNG, two pixels to the point. */
export async function renderConversation(input: SnapshotInput): Promise<Buffer> {
  const timeZone = input.timeZone || process.env.STUDIO_TIMEZONE || "Australia/Melbourne";
  const ours = input.platform === "instagram" ? "#3797F0" : "#0084FF";
  const initial = (input.customerName.trim()[0] || "?").toUpperCase();

  const header = h(
    "div",
    { display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid #EDEDED" },
    [
      h(
        "div",
        {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundImage: "linear-gradient(135deg, #F9CE34, #EE2A7B 55%, #6228D7)",
          color: "#fff",
          fontSize: 16,
          fontWeight: 600,
        },
        initial
      ),
      h("div", { display: "flex", flexDirection: "column" }, [
        h("div", { fontSize: 15, fontWeight: 600, color: "#111" }, input.customerName),
        h(
          "div",
          { fontSize: 12, color: "#8A8A8A", marginTop: 1 },
          `${input.platform === "instagram" ? "Instagram" : "Messenger"} · ${input.studioName}`
        ),
      ]),
    ]
  );

  const rows: Node[] = [];
  let lastAt = 0;
  for (let i = 0; i < input.turns.length; i++) {
    const turn = input.turns[i];
    const at = turn.at ? new Date(turn.at).getTime() : 0;
    // A time line where Instagram would put one: at the top, and after a gap.
    if (at && (!lastAt || at - lastAt > 60 * 60_000)) {
      rows.push(
        h("div", { display: "flex", justifyContent: "center", fontSize: 11, color: "#8A8A8A", margin: "10px 0 6px" }, clock(turn.at, timeZone))
      );
    }
    if (at) lastAt = at;

    const mine = turn.from === "studio";
    const align = mine ? "flex-end" : "flex-start";

    for (const photo of turn.photos ?? []) {
      const tile = await photoTile(photo.bytes);
      if (!tile) continue;
      rows.push(
        h("div", { display: "flex", justifyContent: align, marginTop: 3 }, [
          h("img", { width: tile.width, height: tile.height, borderRadius: 18, objectFit: "cover" }, undefined, {
            src: tile.src,
            width: tile.width,
            height: tile.height,
          }),
        ])
      );
    }
    for (let m = 0; m < (turn.missingPhotos ?? 0); m++) {
      rows.push(
        h("div", { display: "flex", justifyContent: align, marginTop: 3 }, [
          h(
            "div",
            {
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 150,
              height: 110,
              borderRadius: 18,
              backgroundColor: "#EFEFEF",
              color: "#8A8A8A",
              fontSize: 12,
            },
            "Photo"
          ),
        ])
      );
    }

    const text = turn.text.trim();
    const onlyPhotoWords = /^\(?(sent (a|\d+) photos?|photo|attachment)\)?$/i.test(text);
    if (text && !(onlyPhotoWords && (turn.photos?.length || turn.missingPhotos))) {
      rows.push(
        h("div", { display: "flex", justifyContent: align, marginTop: 3 }, [
          h(
            "div",
            {
              display: "flex",
              maxWidth: 272,
              padding: "8px 12px",
              borderRadius: 18,
              backgroundColor: mine ? ours : "#EFEFEF",
              color: mine ? "#fff" : "#111",
              fontSize: 15,
              lineHeight: 1.35,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            },
            text.length > 700 ? `${text.slice(0, 700)}…` : text
          ),
        ])
      );
    }
  }

  if (input.footnote) {
    rows.push(h("div", { display: "flex", justifyContent: "flex-end", fontSize: 11, color: "#8A8A8A", marginTop: 4, paddingRight: 4 }, input.footnote));
  }

  const tree = h(
    "div",
    { display: "flex", flexDirection: "column", width: WIDTH, backgroundColor: "#fff", fontFamily: "Inter" },
    [header, h("div", { display: "flex", flexDirection: "column", padding: "6px 12px 18px" }, rows)]
  );

  const svg = await satori(tree as never, {
    width: WIDTH,
    fonts: await loadFonts(),
    loadAdditionalAsset: async (code: string, segment: string) => {
      if (code === "emoji") return (await emojiDataUri(segment)) ?? segment;
      return [];
    },
  });

  // density 144 is two pixels per point — a phone-sharp picture.
  return sharp(Buffer.from(svg), { density: 144 }).png({ compressionLevel: 9 }).toBuffer();
}
