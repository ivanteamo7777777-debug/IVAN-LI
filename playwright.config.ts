import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    serviceWorkers: "allow",
  },
  webServer: process.env.PLAYWRIGHT_NO_SERVER
    ? undefined
    : {
        command: "pnpm start",
        url: "http://127.0.0.1:3000/setup",
        reuseExistingServer: !process.env.CI,
        env: { NEXT_PUBLIC_E2E_MODE: "1" },
        timeout: 120_000,
      },
  projects: [
    {
      name: "ipad",
      use: { ...devices["iPad Pro 11"] },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 14"] },
    },
  ],
});
