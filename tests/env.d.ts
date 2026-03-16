import type { readD1Migrations } from "@cloudflare/vitest-pool-workers";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: Awaited<ReturnType<typeof readD1Migrations>>;
  }
}
