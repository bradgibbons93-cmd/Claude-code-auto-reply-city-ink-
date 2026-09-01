import crypto from "node:crypto";
import webpush from "web-push";
import { eq, sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { appSettings, pushSubscriptions } from "../drizzle/schema.js";

/**
 * Notifications that actually reach the phone.
 *
 * There was already a way to tell Brad something had come in: a Messenger
 * message to his own thread with the Page. It works, and it keeps working —
 * but only inside Facebook's 24-hour messaging window, which closes when he
 * hasn't messaged the Page recently. So the one channel the studio had went
 * quiet during exactly the slow weeks where a missed enquiry costs the most.
 *
 * Web push has no window. The browser holds the subscription, the phone gets
 * the buzz whether or not anything is open, and it costs nothing per message.
 * On iOS it requires the dashboard to be added to the home screen first —
 * that's Apple's rule, not ours, and the Settings panel says so plainly
 * rather than letting the button fail with no explanation.
 */

const VAPID_PUBLIC = "vapid_public_key";
const VAPID_PRIVATE = "vapid_private_key";
const NOTIFY_SETTINGS = "notify_settings";

export interface NotifySettings {
  /** A customer sends anything at all. */
  onMessage: boolean;
  /** The agent has captured a name, a phone number and dates. */
  onBooking: boolean;
  /** A draft reply is waiting for approval. Off by default — it follows a message. */
  onDraft: boolean;
  /** Something the studio should look at: a token expiring, deliveries being refused. */
  onProblem: boolean;
  /** "22:00" — no message notifications from here… */
  quietFrom: string;
  /** …until here. Bookings and problems still come through. */
  quietTo: string;
  /** Minutes before the same thread may buzz again. */
  throttleMinutes: number;
}

export const DEFAULT_SETTINGS: NotifySettings = {
  onMessage: true,
  onBooking: true,
  onDraft: false,
  onProblem: true,
  quietFrom: "22:00",
  quietTo: "07:00",
  throttleMinutes: 10,
};

async function readSetting(name: string): Promise<string | undefined> {
  const db = await getDb();
  const rows = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.name, name))
    .limit(1);
  return rows[0]?.value ?? undefined;
}

async function writeSetting(name: string, value: string): Promise<void> {
  const db = await getDb();
  await db
    .insert(appSettings)
    .values({ name, value })
    .onDuplicateKeyUpdate({ set: { value } });
}

/**
 * The keypair that identifies this server to the push services.
 *
 * Generated once and kept. Regenerating it is not a harmless reset: every
 * subscription already handed out was signed against the old public key, and
 * a new pair silently orphans all of them — the button in Settings still says
 * "on" and nothing ever arrives again. So it is written once, and the
 * environment can override it if the studio ever wants the keys held there.
 */
export async function getVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const fromEnv = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY;
  if (fromEnv) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY as string,
      privateKey: process.env.VAPID_PRIVATE_KEY as string,
    };
  }

  const [publicKey, privateKey] = await Promise.all([
    readSetting(VAPID_PUBLIC),
    readSetting(VAPID_PRIVATE),
  ]);
  if (publicKey && privateKey) return { publicKey, privateKey };

  const generated = webpush.generateVAPIDKeys();
  await writeSetting(VAPID_PUBLIC, generated.publicKey);
  await writeSetting(VAPID_PRIVATE, generated.privateKey);
  console.log("[Push] Generated this app's notification keys — they'll be reused from now on");
  return generated;
}

/**
 * The address in the VAPID claim has to be a real contact for the push
 * service. The studio's own dashboard is the honest answer; a mailto is
 * accepted by every service and needs no DNS.
 */
function contact(): string {
  return process.env.VAPID_SUBJECT || "mailto:studio@cityinktattoo.example";
}

export async function getNotifySettings(): Promise<NotifySettings> {
  const raw = await readSetting(NOTIFY_SETTINGS).catch(() => undefined);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<NotifySettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function setNotifySettings(next: Partial<NotifySettings>): Promise<NotifySettings> {
  const merged = { ...(await getNotifySettings()), ...next };
  await writeSetting(NOTIFY_SETTINGS, JSON.stringify(merged));
  return merged;
}

/** Same device, same row. Re-subscribing must not double the buzzes. */
function idFor(endpoint: string): string {
  return crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 40);
}

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function saveSubscription(
  sub: BrowserSubscription,
  label?: string
): Promise<{ id: string }> {
  const id = idFor(sub.endpoint);
  const db = await getDb();
  await db
    .insert(pushSubscriptions)
    .values({
      id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      label: label?.slice(0, 190) || null,
      failures: 0,
    })
    .onDuplicateKeyUpdate({
      set: {
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        label: label?.slice(0, 190) || null,
        // A device coming back is a working device, whatever it did before.
        failures: 0,
      },
    });
  return { id };
}

export async function removeSubscription(endpoint: string): Promise<void> {
  const db = await getDb();
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, idFor(endpoint)));
}

export async function listSubscriptions() {
  const db = await getDb();
  return db
    .select({
      id: pushSubscriptions.id,
      label: pushSubscriptions.label,
      lastSentAt: pushSubscriptions.lastSentAt,
      failures: pushSubscriptions.failures,
      createdAt: pushSubscriptions.createdAt,
    })
    .from(pushSubscriptions)
    .limit(50);
}

export async function countSubscriptions(): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(pushSubscriptions);
  return Number(row?.count ?? 0);
}

/** "22:00"→"07:00" wraps midnight, which is the shape a studio's night is. */
export function inQuietHours(settings: NotifySettings, now = new Date()): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const parse = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  };
  const from = parse(settings.quietFrom);
  const to = parse(settings.quietTo);
  if (from === null || to === null || from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping it should land. Relative to the dashboard. */
  url?: string;
  /** Notifications sharing a tag replace each other rather than stacking. */
  tag?: string;
  /** Bookings and faults ignore quiet hours; a message doesn't. */
  urgent?: boolean;
}

/**
 * Send to every registered device.
 *
 * Never throws. A notification failing must not take down the thing it was
 * notifying about — an enquiry still has to be stored and drafted even if
 * nobody's phone can be reached.
 */
export async function sendPush(message: PushMessage): Promise<{ sent: number; dropped: number }> {
  let sent = 0;
  let dropped = 0;
  try {
    const db = await getDb();
    const subs = await db.select().from(pushSubscriptions).limit(50);
    if (!subs.length) return { sent, dropped };

    const keys = await getVapidKeys();
    webpush.setVapidDetails(contact(), keys.publicKey, keys.privateKey);

    const payload = JSON.stringify({
      title: message.title,
      body: message.body,
      url: message.url ?? "/",
      tag: message.tag ?? "cityink",
    });

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 60 * 60 * 6 }
        );
        sent += 1;
        await db
          .update(pushSubscriptions)
          .set({ lastSentAt: new Date(), failures: 0 })
          .where(eq(pushSubscriptions.id, sub.id));
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode ?? 0;
        // 404/410 is the push service saying this device is gone for good.
        // Keeping it would mean retrying a dead endpoint forever.
        if (status === 404 || status === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
          dropped += 1;
          continue;
        }
        await db
          .update(pushSubscriptions)
          .set({ failures: (sub.failures ?? 0) + 1 })
          .where(eq(pushSubscriptions.id, sub.id));
        // The message matters as much as the status: a rejection with no
        // status at all is a transport fault, not the push service saying no.
        console.warn(
          `[Push] ${sub.label || "a device"} refused a notification` +
            `${status ? ` (${status})` : ""} — ${(error as Error).message}`
        );
      }
    }
  } catch (error) {
    console.error("[Push] Send failed:", (error as Error).message);
  }
  if (sent || dropped) {
    console.log(`[Push] Sent ${sent}${dropped ? `, dropped ${dropped} dead device(s)` : ""}`);
  }
  return { sent, dropped };
}

/**
 * A fault worth telling someone about, at most once a day.
 *
 * The faults this app has actually had — an expired token, a subscription
 * Facebook dropped, every delivery refused over a stale app secret — are all
 * silent from the outside. The dashboard reads green, the inbox simply stops,
 * and nobody finds out until somebody asks why a customer never got a reply.
 *
 * Facebook retries a refused delivery, so without the once-a-day guard the
 * same fault would buzz forty times an hour and get muted, which is the same
 * as not knowing.
 */
export async function notifyOnce(
  key: string,
  message: PushMessage,
  withinHours = 24
): Promise<{ sent: number; skipped?: string }> {
  const name = `alerted_${key}`.slice(0, 64);
  const last = Number((await readSetting(name).catch(() => undefined)) ?? 0);
  if (last && Date.now() - last < withinHours * 3600_000) {
    return { sent: 0, skipped: "already flagged today" };
  }
  const result = await notify("problem", message);
  if (result.sent) await writeSetting(name, String(Date.now())).catch(() => undefined);
  return result;
}

/** The fault has cleared, so the next one is allowed to buzz again. */
export async function clearAlert(key: string): Promise<void> {
  const db = await getDb();
  await db
    .delete(appSettings)
    .where(eq(appSettings.name, `alerted_${key}`.slice(0, 64)))
    .catch(() => undefined);
}

/**
 * The one entry point the rest of the app uses. Applies the studio's own
 * switches, so a caller never has to know about quiet hours or preferences.
 */
export async function notify(
  kind: "message" | "booking" | "draft" | "problem",
  message: PushMessage
): Promise<{ sent: number; skipped?: string }> {
  const settings = await getNotifySettings().catch(() => DEFAULT_SETTINGS);

  const wanted =
    kind === "message"
      ? settings.onMessage
      : kind === "booking"
        ? settings.onBooking
        : kind === "draft"
          ? settings.onDraft
          : settings.onProblem;
  if (!wanted) return { sent: 0, skipped: "turned off" };

  // A booking or a fault is worth waking someone for. A message isn't.
  const urgent = message.urgent ?? (kind === "booking" || kind === "problem");
  if (!urgent && inQuietHours(settings)) return { sent: 0, skipped: "quiet hours" };

  const { sent } = await sendPush(message);
  return { sent };
}
