import { defineConfig, devices } from "playwright/test";

// globalSetup picks free ports and exports PLAYWRIGHT_BASE_URL plus the
// fake OIDC issuer so each run is hermetic and never collides with a
// local dev server (e.g. tessera on 5174).
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL,
    trace: "on",
    screenshot: "on",
    video: "on",
  },
  projects: [
    {
      name: "chromium",
      use: devices["Desktop Chrome"],
    },
  ],
});
