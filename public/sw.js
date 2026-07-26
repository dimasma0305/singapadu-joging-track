const APP_SCOPE = self.registration.scope;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedUrl = event.notification.data?.url;
  const targetUrl = new URL(requestedUrl || "./", APP_SCOPE).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windowClients) => {
        const existingClient = windowClients.find((client) =>
          client.url.startsWith(APP_SCOPE)
        );

        if (existingClient) {
          if ("navigate" in existingClient && existingClient.url !== targetUrl) {
            await existingClient.navigate(targetUrl);
          }
          return existingClient.focus();
        }

        return self.clients.openWindow(targetUrl);
      })
  );
});
