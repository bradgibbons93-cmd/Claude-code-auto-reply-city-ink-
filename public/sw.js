/*
 * The service worker exists for one reason: a phone can only be notified by
 * something that is still running when the tab isn't. It deliberately does
 * no caching — an offline copy of a live inbox is worse than no inbox, and
 * a stale dashboard that looks current is how someone misses an enquiry.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "City Ink", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "City Ink";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      // The studio's mark, so the notification is recognisable at a glance
      // on a lock screen full of everything else.
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Same tag replaces rather than stacks: a thread that sends three
      // messages should be one line on the lock screen, not three.
      tag: data.tag || "cityink",
      renotify: true,
      data: { url: data.url || "/" },
    })
  );
});

/*
 * Tapping it should land on the thing it was about, in a tab that is already
 * open if there is one. Opening a second copy of the dashboard every time is
 * how a phone ends up with eleven of them.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
