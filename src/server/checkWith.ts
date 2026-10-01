import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, getSetting, setSetting, getConversation, getRecentTurns, isPlaceholderName } from "./db.js";
import { readAttachment } from "./attachments.js";
import { renderConversation, type SnapshotTurn } from "./snapshot.js";
import { studioIdentity } from "./studios.js";
import { notifyOnce, clearAlert } from "./push.js";

/**
 * "We'll check with Mim."
 *
 * Brad, 29 September: "If anything is written that we will check with Mim
 * (please fix spelling in the app) then take a screenshot and send Mim an
 * email checking." Mim is the artist; when a reply to a customer promises
 * she'll look at something — a budget, a date, a design — she has to actually
 * hear about it, or the promise is made to the customer and kept by nobody.
 *
 * So: when a message the studio SENDS says it will check with her, she gets an
 * email with a picture of the conversation. Sent, not drafted — a draft Brad
 * rewrites or discards promised nobody anything, and emailing her for it is
 * how an inbox learns to ignore these. Both ways a reply leaves count: the
 * Approve button, and a reply typed by hand in Instagram (Brad copies drafts
 * across all day), which comes back to us as an echo.
 *
 * Why not Gmail's SMTP: Railway refuses outbound SMTP below the Pro plan —
 * their docs, in as many words. So the email goes out through a small Google
 * Apps Script in Brad's own Google account, called over HTTPS. It sends as
 * him, from his Gmail, so Mim sees who it's from and her reply lands with him.
 */

export interface CheckWithConfig {
  /** Who the studio checks with, spelled the way she spells it. Empty = off. */
  name: string;
  email: string;
  relayUrl: string;
  secret: string;
}

// Unset falls back to the environment; saved-but-empty means "off" on purpose.
async function settingOr(name: string, env: string | undefined): Promise<string> {
  const saved = await getSetting(name).catch(() => undefined);
  return (saved ?? env ?? "").trim();
}

export async function getCheckWith(): Promise<CheckWithConfig> {
  let secret = (await getSetting("mail_relay_secret").catch(() => undefined)) ?? "";
  if (!secret) {
    // Made once. The script in Brad's Google account carries the same value,
    // so regenerating it would silently break the email with nothing to say so.
    secret = randomBytes(18).toString("base64url");
    await setSetting("mail_relay_secret", secret).catch(() => undefined);
  }
  return {
    name: await settingOr("check_with_name", process.env.CHECK_WITH_NAME),
    email: await settingOr("check_with_email", process.env.CHECK_WITH_EMAIL),
    relayUrl: await settingOr("mail_relay_url", process.env.MAIL_RELAY_URL),
    secret,
  };
}

export async function saveCheckWith(input: { name: string; email: string; relayUrl: string }): Promise<void> {
  await setSetting("check_with_name", input.name.trim());
  await setSetting("check_with_email", input.email.trim());
  await setSetting("mail_relay_url", input.relayUrl.trim());
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does this message tell the customer we'll check with her?
 *
 * Deliberately narrow. "Mim can do 3pm" is an answer, not a deferral, and
 * "would you like to confirm the booking with Mim" is the customer's move —
 * neither should email her. What counts is us checking, asking, running it
 * past her, or her getting back to them.
 */
export function mentionsCheckWith(text: string, name: string): boolean {
  if (!text || !name || name.length < 2) return false;
  const n = `${escape(name)}(?:'s)?\\b`;
  const patterns = [
    // check with Mim · double-check that with Mim · touch base with Mim · run it by Mim
    `\\b(?:check|checking|double[- ]check|confirm|confirming|touch base|chat|talk|speak|see)\\s+(?:(?:it|this|that|these|those|in|the price|the time|the date|quickly|first)\\s+)?(?:with|to|by|past)\\s+${n}`,
    `\\brun(?:ning)?\\s+(?:it|this|that|these)\\s+(?:by|past)\\s+${n}`,
    // ask Mim · asking Mim
    `\\b(?:ask|asking|il ask|i'll ask)\\s+${n}`,
    // Mim will get back to you · Mim can have a look · Mim'll confirm
    `\\b${escape(name)}(?:'ll|\\s+will|\\s+can|\\s+should)\\s+(?:confirm|check|get back|let (?:you|us) know|come back|have a look|take a look|look)`,
    // see what Mim says / thinks
    `\\bsee what\\s+${escape(name)}\\s+(?:says|thinks)`,
  ];
  return patterns.some((p) => new RegExp(p, "i").test(text));
}

/**
 * Her name the way she spells it. Customers write "mim"; the model has copied
 * them. Only the name itself, as a whole word, in any case — nothing clever
 * that could rename a customer who happens to be called something similar.
 */
export function fixNameSpelling(text: string, name: string): string {
  if (!text || !name || name.length < 2) return text;
  return text.replace(new RegExp(`\\b${escape(name)}\\b`, "gi"), (m) => (m === name ? m : name));
}

/* ------------------------------------------------------------------ */

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function listOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value !== "string") return [];
  try {
    return listOf(JSON.parse(value));
  } catch {
    return [];
  }
}

/** The customer, as the email and the picture should name them. */
async function whoIs(conversationId: string) {
  const convo = await getConversation(conversationId).catch(() => undefined);
  const raw = convo?.senderName?.trim();
  return {
    name: raw && !isPlaceholderName(raw) ? raw : "A customer",
    platform: (convo?.platform === "instagram" ? "instagram" : "facebook") as "facebook" | "instagram",
  };
}

/**
 * The last few messages of a thread as a picture. The photos are the copies
 * this app kept; Meta's own links die in days and are drawn as a plain tile.
 */
export async function snapshotConversation(conversationId: string, footnote?: string): Promise<Buffer> {
  const [turns, who, studio] = await Promise.all([
    getRecentTurns(conversationId, 8),
    whoIs(conversationId),
    studioIdentity(),
  ]);

  let photoBudget = 4;
  const drawn: SnapshotTurn[] = [];
  // Newest photos matter most, so spend the budget from the end.
  for (const turn of [...turns].reverse()) {
    const photos: SnapshotTurn["photos"] = [];
    let missing = 0;
    for (const url of listOf(turn.attachmentUrls)) {
      const id = url.match(/\/api\/attachments\/([^/?#]+)/)?.[1];
      const kept = id && photoBudget > 0 ? await readAttachment(id).catch(() => undefined) : undefined;
      if (kept?.bytes?.length && PHOTO_TYPES.has(kept.contentType)) {
        photos.push({ bytes: Buffer.from(kept.bytes), contentType: kept.contentType });
        photoBudget--;
      } else {
        missing++;
      }
    }
    drawn.unshift({
      from: turn.senderType === "customer" ? "customer" : "studio",
      text: turn.content ?? "",
      at: turn.createdAt,
      photos,
      missingPhotos: Math.min(missing, 2),
    });
  }

  return renderConversation({
    customerName: who.name,
    platform: who.platform,
    studioName: studio.name,
    turns: drawn,
    footnote,
  });
}

/** A made-up conversation, for the preview in Settings and the test email. */
export async function snapshotSample(name: string): Promise<Buffer> {
  const studio = await studioIdentity();
  const now = Date.now();
  return renderConversation({
    customerName: "Sample customer",
    platform: "instagram",
    studioName: studio.name,
    footnote: `Sent · waiting on ${name || "you"}`,
    turns: [
      { from: "customer", text: "Hey! How much would a small rose on my wrist be? 🌹", at: new Date(now - 5 * 60_000) },
      { from: "studio", text: "Hey 😊 thanks for getting in touch! You'd be looking at about $150 - $200 for that size", at: new Date(now - 4 * 60_000) },
      { from: "customer", text: "Amazing! Could I come in this Saturday morning?", at: new Date(now - 60_000) },
      { from: "studio", text: `I'll check with ${name || "the artist"} and get back to you 🙂`, at: new Date(now) },
    ],
  });
}

/* ------------------------------------------------------------------ */

interface RelayMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
  image?: Buffer;
}

/**
 * Posts one email to the Apps Script. Google answers a web app POST with a
 * redirect to where the result is, and fetch follows it. Anything that isn't
 * the script's own JSON is almost always Google's sign-in page — the one
 * setting that has to be right on the deployment — so say that, not "error".
 */
async function relay(url: string, secret: string, message: RelayMessage): Promise<{ to?: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      secret,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      fromName: message.fromName,
      image: message.image?.toString("base64"),
    }),
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  let body: { ok?: boolean; error?: string; to?: string } | undefined;
  try {
    body = JSON.parse(raw);
  } catch {
    /* not the script talking */
  }
  if (!body) {
    if (/accounts\.google\.com|ServiceLogin|Sign in/i.test(raw)) {
      throw new Error(
        "Google asked for a sign-in instead of running the script. In Apps Script, Deploy → Manage deployments → edit → set \"Who has access\" to Anyone."
      );
    }
    throw new Error(`The email script didn't answer properly (HTTP ${response.status}). Check the web app address in Settings is the one ending in /exec.`);
  }
  if (!body.ok) {
    if (/wrong secret/i.test(body.error ?? "")) {
      throw new Error("The script in Google has a different key from this app. Copy the script from Settings again and redeploy it.");
    }
    throw new Error(body.error || "The email script said no without saying why.");
  }
  return { to: body.to };
}

const html = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function composeEmail(opts: {
  checker: string;
  customer: string;
  platform: "facebook" | "instagram";
  studio: string;
  theyAsked?: string;
  sample?: boolean;
}) {
  const inbox = opts.platform === "instagram" ? "Instagram" : "Messenger";
  const subject = opts.sample
    ? `Test — this is what ${opts.checker} will get`
    : `Can you check this one? — ${opts.customer} (${inbox})`;
  const lead = opts.sample
    ? `This is a test. When a reply to a customer says we'll check with ${opts.checker}, an email like this goes to ${opts.checker} with a picture of the conversation.`
    : `${opts.customer} messaged ${opts.studio} on ${inbox}, and we've told them we'll check with you. Can you have a look and let us know?`;
  const quote = opts.theyAsked?.trim()
    ? `<p style="margin:0 0 16px;padding:10px 14px;border-left:3px solid #d9d9d9;color:#333;background:#fafafa;border-radius:4px">“${html(opts.theyAsked.trim().slice(0, 400))}”</p>`
    : "";
  const body = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:480px">
<p style="margin:0 0 12px">Hi ${html(opts.checker)},</p>
<p style="margin:0 0 16px">${html(lead)}</p>
${quote}<img src="cid:conversation" alt="The conversation with ${html(opts.customer)}" width="390" style="display:block;width:100%;max-width:390px;height:auto;border:1px solid #e6e6e6;border-radius:16px">
<p style="margin:16px 0 0">Just reply to this email with what you think.</p>
<p style="margin:20px 0 0;font-size:12px;color:#999">Sent automatically by ${html(opts.studio)}'s inbox when a reply said we'd check with you.</p>
</div>`;
  const text = `Hi ${opts.checker},\n\n${lead}\n\n${opts.theyAsked ? `They said: "${opts.theyAsked.trim().slice(0, 400)}"\n\n` : ""}The conversation is in the picture in this email.\n\nJust reply to this email with what you think.`;
  return { subject, html: body, text };
}

/* ------------------------------------------------------------------ */

/**
 * One email per promise. The same reply can reach us twice — once from the
 * Approve button and again as Instagram's echo of it, under a different id —
 * so it's keyed on the words, the person and the day, not the message id.
 */
async function claim(conversationId: string, text: string): Promise<number | null> {
  const day = new Date().toLocaleDateString("en-CA", { timeZone: process.env.STUDIO_TIMEZONE || "Australia/Melbourne" });
  const key = createHash("sha256")
    .update(`${conversationId}|${text.replace(/\s+/g, " ").trim().toLowerCase()}|${day}`)
    .digest("hex")
    .slice(0, 48);
  const db = await getDb();
  try {
    const [result] = (await db.execute(
      sql`INSERT INTO check_alerts (alert_key, conversation_id, message_text, status) VALUES (${key}, ${conversationId}, ${text.slice(0, 2000)}, 'pending')`
    )) as unknown as [{ insertId: number }];
    return Number(result.insertId);
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    if (e.code === "ER_DUP_ENTRY" || e.cause?.code === "ER_DUP_ENTRY") return null;
    throw error;
  }
}

async function settle(id: number, status: "sent" | "failed", detail: string) {
  const db = await getDb();
  await db
    .execute(sql`UPDATE check_alerts SET status = ${status}, detail = ${detail.slice(0, 1000)} WHERE id = ${id}`)
    .catch(() => undefined);
}

async function sendAbout(conversationId: string, cfg: CheckWithConfig): Promise<string> {
  const [who, studio, turns] = await Promise.all([
    whoIs(conversationId),
    studioIdentity(),
    getRecentTurns(conversationId, 8),
  ]);
  const theyAsked = [...turns].reverse().find((t) => t.senderType === "customer")?.content;
  let image: Buffer | undefined;
  try {
    image = await snapshotConversation(conversationId, `Sent · waiting on ${cfg.name}`);
  } catch (error) {
    // The words still go. A missing picture is worse than none of the email.
    console.error(`[CheckWith] Couldn't draw the conversation: ${(error as Error).message}`);
  }
  const email = composeEmail({
    checker: cfg.name,
    customer: who.name,
    platform: who.platform,
    studio: studio.name,
    theyAsked: theyAsked && !/^\(sent/i.test(theyAsked) ? theyAsked : undefined,
  });
  await relay(cfg.relayUrl, cfg.secret, { to: cfg.email, fromName: studio.name, image, ...email });
  return who.name;
}

/**
 * Called with every message the studio sends. Does nothing unless it says
 * we'll check with her; otherwise emails her, once, and never throws — a
 * reply that reached the customer must not look failed because of this.
 */
export async function askToCheck(conversationId: string, text: string, source: "approved" | "typed"): Promise<void> {
  try {
    const cfg = await getCheckWith();
    if (!cfg.name || !mentionsCheckWith(text, cfg.name)) return;

    const id = await claim(conversationId, text);
    if (id === null) return; // already emailed about this exact message today

    if (!cfg.email || !cfg.relayUrl) {
      const missing = !cfg.email ? `${cfg.name}'s email address` : "the email connection";
      await settle(id, "failed", `Not sent — ${missing} isn't set up yet.`);
      console.warn(`[CheckWith] A reply to ${conversationId} says we'll check with ${cfg.name}, but ${missing} isn't set up — nothing emailed`);
      await notifyOnce("checkwith", {
        title: `${cfg.name} wasn't emailed`,
        body: `A reply said you'd check with ${cfg.name}. Set up ${missing} in Settings → Inbox so ${cfg.name} hears about these.`,
        url: "/settings?tab=inbox#check-with",
        tag: "checkwith",
      }).catch(() => undefined);
      return;
    }

    try {
      const customer = await sendAbout(conversationId, cfg);
      await settle(id, "sent", `Emailed ${cfg.email}`);
      console.log(`[CheckWith] Emailed ${cfg.name} about ${customer} (${conversationId}, ${source} reply)`);
      await clearAlert("checkwith").catch(() => undefined);
    } catch (error) {
      const detail = (error as Error).message;
      await settle(id, "failed", detail);
      console.error(`[CheckWith] Couldn't email ${cfg.name} about ${conversationId}: ${detail}`);
      await notifyOnce(
        "checkwith",
        {
          title: `Couldn't email ${cfg.name}`,
          body: detail.slice(0, 160),
          url: "/settings?tab=inbox#check-with",
          tag: "checkwith",
        },
        6
      ).catch(() => undefined);
    }
  } catch (error) {
    console.error(`[CheckWith] ${(error as Error).message}`);
  }
}

/** The "Send to Mim" button — this thread, now, whatever the last reply said. */
export async function sendNow(conversationId: string): Promise<{ ok: boolean; detail: string }> {
  const cfg = await getCheckWith();
  if (!cfg.name || !cfg.email) return { ok: false, detail: "Add who you check with, and their email, in Settings → Inbox first." };
  if (!cfg.relayUrl) return { ok: false, detail: "Email isn't connected yet — Settings → Inbox → Checking with." };
  try {
    const customer = await sendAbout(conversationId, cfg);
    console.log(`[CheckWith] Emailed ${cfg.name} about ${customer} (${conversationId}, sent by hand)`);
    return { ok: true, detail: `Emailed ${cfg.name} about ${customer}` };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  }
}

/** The test button. Goes to Brad's own inbox, never to her. */
export async function sendTest(): Promise<{ ok: boolean; detail: string }> {
  const cfg = await getCheckWith();
  if (!cfg.relayUrl) return { ok: false, detail: "Paste the web app address from Apps Script first." };
  try {
    const studio = await studioIdentity();
    const name = cfg.name || "the artist";
    const email = composeEmail({ checker: name, customer: "Sample customer", platform: "instagram", studio: studio.name, sample: true });
    const result = await relay(cfg.relayUrl, cfg.secret, {
      to: "me",
      fromName: studio.name,
      image: await snapshotSample(name),
      ...email,
    });
    return { ok: true, detail: `Test sent to ${result.to || "your own Gmail"} — have a look.` };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  }
}

export async function recentChecks(limit = 5) {
  const db = await getDb();
  const [rows] = (await db
    .execute(
      sql`SELECT a.id, a.conversation_id AS conversationId, a.status, a.detail, a.created_at AS createdAt, c.sender_name AS senderName
          FROM check_alerts a LEFT JOIN messenger_conversations c ON c.conversation_id = a.conversation_id
          ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit}`
    )
    .catch(() => [[]])) as unknown as [Array<Record<string, unknown>>];
  return (rows ?? []).map((r) => ({
    id: Number(r.id),
    conversationId: String(r.conversationId),
    customer: r.senderName && !isPlaceholderName(String(r.senderName)) ? String(r.senderName) : "A customer",
    status: String(r.status),
    detail: r.detail ? String(r.detail) : "",
    createdAt: r.createdAt as Date | string | null,
  }));
}

/**
 * The Apps Script Brad pastes into his Google account. It carries this app's
 * key, so a stranger who found the web app's address still can't send mail
 * as him with it.
 */
export function relayScript(secret: string): string {
  return `// Runnit → Gmail. Sends the "can you check this?" emails from your own Gmail.
// Paste all of this into a new Apps Script project, then Deploy → New deployment →
// Web app, "Execute as: Me", "Who has access: Anyone".
const KEY = "${secret}";

function doPost(e) {
  try {
    const m = JSON.parse(e.postData.contents);
    if (m.secret !== KEY) return reply({ ok: false, error: "wrong secret" });
    const to = m.to === "me" ? Session.getEffectiveUser().getEmail() : m.to;
    const options = { htmlBody: m.html, name: m.fromName || undefined };
    if (m.image) {
      options.inlineImages = {
        conversation: Utilities.newBlob(Utilities.base64Decode(m.image), "image/png", "conversation.png"),
      };
    }
    MailApp.sendEmail(to, m.subject, m.text || "", options);
    return reply({ ok: true, to: to });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
`;
}
