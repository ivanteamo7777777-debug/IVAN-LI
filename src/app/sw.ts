import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, Serwist, StaleWhileRevalidate } from "serwist";
import {
  isAuthenticatedAppPath,
  shouldCacheAuthenticatedNavigation,
} from "@/lib/pwa-cache";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const RUNTIME_CACHE_VERSION =
  process.env.NEXT_PUBLIC_RUNTIME_CACHE_VERSION ?? "local";
const AUTHENTICATED_SHELL_CACHE = `shouzhong-authenticated-shell-${RUNTIME_CACHE_VERSION}`;
const AUTHENTICATED_RSC_CACHE = `shouzhong-authenticated-rsc-${RUNTIME_CACHE_VERSION}`;
const AUTHENTICATED_RSC_PREFETCH_CACHE = `shouzhong-authenticated-rsc-prefetch-${RUNTIME_CACHE_VERSION}`;
const CURRENT_AUTHENTICATED_CACHES = new Set([
  AUTHENTICATED_SHELL_CACHE,
  AUTHENTICATED_RSC_CACHE,
  AUTHENTICATED_RSC_PREFETCH_CACHE,
]);
const LEGACY_NEXT_PAGE_CACHES = new Set([
  "pages",
  "pages-rsc",
  "pages-rsc-prefetch",
]);

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                !CURRENT_AUTHENTICATED_CACHES.has(name) &&
                (name.startsWith("shouzhong-authenticated-shell") ||
                  name.startsWith("shouzhong-authenticated-rsc") ||
                  LEGACY_NEXT_PAGE_CACHES.has(name)),
            )
            .map((name) => caches.delete(name)),
        ),
      ),
  );
});

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
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((client) => "focus" in client);
        if (existing && "navigate" in existing) {
          return existing.navigate(url).then(() => existing.focus());
        }
        return self.clients.openWindow(url);
      }),
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
          request.headers.get("RSC") === "1" &&
          request.headers.get("Next-Router-Prefetch") === "1" &&
          isAuthenticatedAppPath(url.pathname)
        );
      },
      handler: new StaleWhileRevalidate({
        cacheName: AUTHENTICATED_RSC_PREFETCH_CACHE,
        plugins: [
          {
            cacheWillUpdate: async ({ response }) =>
              shouldCacheAuthenticatedNavigation(response) ? response : null,
          },
          new ExpirationPlugin({
            maxEntries: 24,
            maxAgeSeconds: 60 * 60 * 24,
          }),
        ],
      }),
    },
    {
      matcher({ request, url }) {
        return (
          request.headers.get("RSC") === "1" &&
          isAuthenticatedAppPath(url.pathname)
        );
      },
      handler: new StaleWhileRevalidate({
        cacheName: AUTHENTICATED_RSC_CACHE,
        plugins: [
          {
            cacheWillUpdate: async ({ response }) =>
              shouldCacheAuthenticatedNavigation(response) ? response : null,
          },
          new ExpirationPlugin({
            maxEntries: 24,
            maxAgeSeconds: 60 * 60 * 24,
          }),
        ],
      }),
    },
    {
      matcher({ request, url }) {
        return (
          request.mode === "navigate" && isAuthenticatedAppPath(url.pathname)
        );
      },
      handler: new StaleWhileRevalidate({
        cacheName: AUTHENTICATED_SHELL_CACHE,
        plugins: [
          {
            cacheWillUpdate: async ({ response }) =>
              shouldCacheAuthenticatedNavigation(response) ? response : null,
          },
          new ExpirationPlugin({
            maxEntries: 24,
            maxAgeSeconds: 60 * 60 * 24 * 7,
          }),
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
