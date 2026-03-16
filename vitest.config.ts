import { fileURLToPath, URL } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig, defineProject } from "vitest/config";

const srcDirectory = fileURLToPath(new URL("./src", import.meta.url));
const drizzleDirectory = fileURLToPath(new URL("./drizzle", import.meta.url));

export default defineConfig(async () => {
  const migrations = await readD1Migrations(drizzleDirectory);
  const workerPoolOptions = {
    wrangler: {
      configPath: "./wrangler.jsonc",
    },
    miniflare: {
      bindings: {
        ADMIN_PASSWORD: "AdminPassword123!#",
        TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
        TEST_MIGRATIONS: migrations,
      },
    },
  };

  return {
    test: {
      projects: [
        defineProject({
          resolve: {
            alias: {
              "@": srcDirectory,
            },
          },
          test: {
            name: "client",
            environment: "jsdom",
            include: ["tests/client/**/*.test.ts", "tests/client/**/*.test.tsx"],
            setupFiles: ["./tests/setup/client.ts"],
          },
        }),
        defineProject({
          plugins: [cloudflareTest(workerPoolOptions)],
          resolve: {
            alias: {
              "@": srcDirectory,
            },
          },
          test: {
            name: "worker",
            include: ["tests/worker/**/*.test.ts"],
            setupFiles: ["./tests/setup/worker.ts"],
          },
        }),
      ],
    },
  };
});
