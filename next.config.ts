import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

if (process.env.NEXT_PUBLIC_E2E_MODE === "1") {
  throw new Error(
    "NEXT_PUBLIC_E2E_MODE is forbidden because it exposes test mode to the browser bundle.",
  );
}
if (process.env.VERCEL === "1" && process.env.SHOUZHONG_E2E_MODE === "1") {
  throw new Error("SHOUZHONG_E2E_MODE must never be enabled on Vercel.");
}

const runtimeCacheVersion = (
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  "local"
).slice(0, 12);

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  additionalPrecacheEntries: [
    { url: "/offline", revision: "shouzhong-offline-v1" },
  ],
  reloadOnOnline: false,
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_RUNTIME_CACHE_VERSION: runtimeCacheVersion,
  },
  experimental: {
    typedEnv: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
