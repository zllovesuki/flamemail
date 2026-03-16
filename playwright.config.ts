import { defineConfig, devices } from "playwright/test";

const baseURL = "http://127.0.0.1:4173";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "AdminPassword123!#";

export default defineConfig({
  testDir: "./tests/e2e",
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
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 4173",
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ADMIN_PASSWORD: adminPassword,
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    },
  },
});
