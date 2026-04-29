import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const VITE_BIN = path.resolve(REPO_ROOT, "node_modules/vite/bin/vite.js");
const OIDC_MOCK_PROVIDER_BIN = path.resolve(
  REPO_ROOT,
  "node_modules/@mongodb-js/oidc-mock-provider/bin/oidc-mock-provider.js",
);
const STATE_PATH_ENV = "FLAMEMAIL_E2E_PERSIST_PATH";
const E2E_OPERATOR_SUB = "00000000-0000-4000-8000-000000000001";

interface E2eContext {
  tempDir: string;
  cloudflareEnv: string;
  devVarsPath: string;
  vite: ChildProcess;
  fakeProvider: ChildProcess;
}

let context: E2eContext | null = null;

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForUrl(url: string, label: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      // not yet ready
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} never became reachable at ${url}`);
}

async function killProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const onExit = () => resolve();
    child.once("exit", onExit);
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 5_000);
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "flamemail-e2e-"));
  const cloudflareEnv = `e2e-${process.pid}-${Date.now()}`;
  const devVarsPath = path.join(REPO_ROOT, `.dev.vars.${cloudflareEnv}`);
  const fakePort = await getFreePort();
  const vitePort = await getFreePort();
  const fakeIssuer = `http://127.0.0.1:${fakePort}`;
  const baseURL = `http://127.0.0.1:${vitePort}`;

  // Per-run .dev.vars file consumed by the cloudflare-vite plugin when
  // CLOUDFLARE_ENV is set on the spawned process. Keeps the user's
  // committed .dev.vars/.dev.vars.example untouched.
  const devVarsContent = [
    `TESSERA_OIDC_ISSUER=${fakeIssuer}`,
    "TESSERA_OIDC_CLIENT_ID=local-flamemail",
    "TESSERA_OIDC_CLIENT_SECRET=local-flamemail-secret-change-me",
    `TESSERA_OPERATOR_SUBS=${E2E_OPERATOR_SUB}`,
    "TURNSTILE_SITE_KEY=1x00000000000000000000AA",
    "TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA",
    "",
  ].join("\n");
  await writeFile(devVarsPath, devVarsContent);

  // Apply migrations into the temp persist-to path so the dev server
  // boots against an empty, fully-migrated D1 each run.
  await execFileAsync(
    "npx",
    ["wrangler", "d1", "migrations", "apply", "flamemail-db", "--local", "--persist-to", tempDir],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, CI: "1", NO_D1_WARNING: "true" },
    },
  );

  const fakeProvider = spawn(
    process.execPath,
    [
      OIDC_MOCK_PROVIDER_BIN,
      "--host",
      "127.0.0.1",
      "--port",
      String(fakePort),
      "--payload",
      JSON.stringify({ sub: E2E_OPERATOR_SUB }),
      "--expiry",
      "300",
      "--skip-refresh-token",
    ],
    {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "inherit", "inherit"],
    },
  );

  await waitForUrl(`${fakeIssuer}/.well-known/openid-configuration`, "fake oidc provider");

  const vite = spawn(process.execPath, [VITE_BIN, "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CLOUDFLARE_ENV: cloudflareEnv,
      [STATE_PATH_ENV]: tempDir,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  await waitForUrl(baseURL, "flamemail dev server", 60_000);

  context = { tempDir, cloudflareEnv, devVarsPath, vite, fakeProvider };
  process.env.PLAYWRIGHT_BASE_URL = baseURL;
  process.env.FAKE_OIDC_ISSUER = fakeIssuer;

  return async () => {
    await teardown(context);
    context = null;
  };
}

async function teardown(ctx: E2eContext | null): Promise<void> {
  if (!ctx) return;
  await Promise.allSettled([killProcess(ctx.vite), killProcess(ctx.fakeProvider)]);
  await rm(ctx.devVarsPath, { force: true });
  await rm(ctx.tempDir, { recursive: true, force: true });
}
