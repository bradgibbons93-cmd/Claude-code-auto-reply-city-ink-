/**
 * Turning phone notifications on, from the browser's side.
 *
 * Three things have to be true and each fails differently, so each gets its
 * own sentence rather than one "notifications aren't supported":
 *
 *   1. The page is on https (or localhost). Push is refused outright on http.
 *   2. On an iPhone, the dashboard has been added to the home screen. Safari
 *      in a normal tab will not deliver a push, ever, and there is no error
 *      to read — the API simply isn't there.
 *   3. The person said yes to the permission prompt, which can only be asked
 *      once. A "block" is permanent until they change it in site settings.
 */

export type PushReadiness =
  | { ok: true }
  | { ok: false; reason: string };

/** Standalone = launched from the home screen rather than a browser tab. */
export function isInstalled(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // Safari's own flag, which predates the standard one and is still what
    // an iPhone reports.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function pushReadiness(): PushReadiness {
  if (!window.isSecureContext) {
    return { ok: false, reason: "Notifications need the dashboard opened over https." };
  }
  if (!("serviceWorker" in navigator)) {
    return { ok: false, reason: "This browser can't do notifications. Chrome or Safari can." };
  }
  if (!("PushManager" in window)) {
    if (isIos() && !isInstalled()) {
      return {
        ok: false,
        reason:
          "On an iPhone, tap Share then “Add to Home Screen”, open it from there, and this button will work.",
      };
    }
    return { ok: false, reason: "This browser can't do notifications. Chrome or Safari can." };
  }
  if (isIos() && !isInstalled()) {
    return {
      ok: false,
      reason:
        "On an iPhone, tap Share then “Add to Home Screen”, open it from there, and this button will work.",
    };
  }
  return { ok: true };
}

/**
 * The VAPID key arrives base64url; the browser wants raw bytes.
 *
 * Backed by an explicit ArrayBuffer rather than the default: TypeScript's DOM
 * types insist the key be a view over a plain ArrayBuffer, and a bare
 * Uint8Array is now typed loosely enough to include shared memory.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalised);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function registerWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export class PushRefused extends Error {}

/**
 * Ask, subscribe, and hand back what the server needs to send to this device.
 * Throws with a sentence a person can act on, never a DOMException.
 */
export async function subscribeThisDevice(publicKey: string): Promise<{
  endpoint: string;
  keys: { p256dh: string; auth: string };
}> {
  const ready = pushReadiness();
  if (!ready.ok) throw new PushRefused(ready.reason);

  const permission = await Notification.requestPermission();
  if (permission === "denied") {
    throw new PushRefused(
      "Notifications are blocked for this site. Turn them back on in the browser's settings for this page, then try again."
    );
  }
  if (permission !== "granted") {
    throw new PushRefused("Notifications weren't turned on — tap Allow when the prompt appears.");
  }

  const registration = await registerWorker();
  // A worker registered a moment ago isn't active yet, and subscribing
  // against an installing worker throws something unreadable.
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  // An old subscription signed against a different key is dead weight —
  // it stays in the browser and silently receives nothing.
  if (existing) await existing.unsubscribe().catch(() => undefined);

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new PushRefused("The browser gave back an incomplete subscription. Try again.");
  }
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

export async function currentEndpoint(): Promise<string | undefined> {
  if (!("serviceWorker" in navigator)) return undefined;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  return subscription?.endpoint;
}

export async function unsubscribeThisDevice(): Promise<string | undefined> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return undefined;
  const { endpoint } = subscription;
  await subscription.unsubscribe().catch(() => undefined);
  return endpoint;
}

/** A name for the row in Settings, so a device can be recognised later. */
export function deviceLabel(): string {
  const agent = navigator.userAgent;
  if (/iphone/i.test(agent)) return "iPhone";
  if (/ipad/i.test(agent)) return "iPad";
  if (/android/i.test(agent)) return "Android phone";
  if (/mac os x/i.test(agent)) return "Mac";
  if (/windows/i.test(agent)) return "Windows PC";
  return "This device";
}
