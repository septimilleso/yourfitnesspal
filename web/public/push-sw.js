self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    payload = null;
  }

  const title = payload?.title || "Riposo finito";
  const url = payload?.url || "/gym/workout";

  event.waitUntil((async () => {
    try {
      const notifications = await self.registration.getNotifications();
      for (const notification of notifications) {
        try {
          notification.close();
        } catch {
          // Continue closing other notifications and always show the new one.
        }
      }
    } catch {
      // Older browsers may not support getNotifications; allow notifications to accumulate.
    }

    await self.registration.showNotification(title, {
      body: "",
      icon: "/pwa-192x192.png",
      data: { url },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/gym/workout";

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = clients.find((candidate) => {
      try {
        return new URL(candidate.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });

    if (client) {
      await client.focus();
      try {
        if (new URL(client.url).pathname !== "/gym/workout") {
          await client.navigate(url);
        }
      } catch {
        // Keep the focused client open if navigating it fails.
      }
      return;
    }

    await self.clients.openWindow(url);
  })());
});
