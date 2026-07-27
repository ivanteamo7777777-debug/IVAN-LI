import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheableResponsePlugin,
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json() as {
    title?: string;
    body?: string;
    url?: string;
    tag?: string;
  };
  event.waitUntil(
    self.registration.showNotification(data.title ?? "守中日课", {
      body: data.body ?? "回到自己的河道，看看今天真正重要的事。",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: data.tag ?? "shouzhong-reminder",
      data: { url: data.url ?? "/today" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = String(event.notification.data?.url ?? "/today");
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(
      (clients) => {
        const existing = clients.find((client) => "focus" in client);
        if (existing && "navigate" in existing) {
          return existing.navigate(url).then(() => existing.focus());
        }
        return self.clients.openWindow(url);
      },
    ),
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "shouzhong-sync") return;
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) =>
        client.postMessage({ type: "SHOUZHONG_SYNC_REQUEST" }),
      );
    }),
  );
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher({ request, url }) {
        return (
          request.mode === "navigate" &&
          [
            "/today",
            "/directions",
            "/plans",
            "/accumulations",
            "/reviews",
            "/settings",
          ].includes(url.pathname)
        );
      },
      handler: new NetworkFirst({
        cacheName: "shouzhong-authenticated-shell",
        networkTimeoutSeconds: 3,
        plugins: [
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new ExpirationPlugin({ maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 7 }),
        ],
      }),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
