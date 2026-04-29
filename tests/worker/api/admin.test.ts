import { env } from "cloudflare:test";
import { OIDCMockProvider } from "@mongodb-js/oidc-mock-provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearOidcCachesForTesting } from "@/worker/services/oidc";
import { apiRequest, resetWorkerState, seedAdminCookieSession, seedDomain } from "./helpers";

const fetchMock = vi.fn<typeof fetch>();

const ISSUER = "http://127.0.0.1:6174";
const DISCOVERY_ENDPOINT = `${ISSUER}/.well-known/openid-configuration`;
const AUTHORIZE_ENDPOINT = `${ISSUER}/api/auth/oauth2/authorize`;
const TOKEN_ENDPOINT = `${ISSUER}/api/auth/oauth2/token`;
const JWKS_ENDPOINT = `${ISSUER}/api/auth/jwks`;
const CLIENT_ID = "local-flamemail";
const ALLOWED_SUB = "00000000-0000-4000-8000-000000000001";
const FLAMEMAIL_ORIGIN = "https://flamemail.devbin.tools";
const SCOPE = "openid profile email";

let mockJwksKeys: Record<string, unknown>[] = [];

function jsonResponse(payload: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

interface MockExchangeOptions {
  idToken?: string;
  status?: number;
  body?: unknown;
  discoveryBody?: unknown;
  discoveryStatus?: number;
  discoveryThrows?: boolean;
}

function discoveryDocument(overrides: Record<string, unknown> = {}) {
  return {
    issuer: ISSUER,
    authorization_endpoint: AUTHORIZE_ENDPOINT,
    token_endpoint: TOKEN_ENDPOINT,
    jwks_uri: JWKS_ENDPOINT,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email"],
    ...overrides,
  };
}

function mockOidcCalls(options: MockExchangeOptions = {}) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === DISCOVERY_ENDPOINT) {
      if (options.discoveryThrows) {
        throw new Error("discovery failed");
      }
      return jsonResponse(options.discoveryBody ?? discoveryDocument(), { status: options.discoveryStatus ?? 200 });
    }
    if (url === JWKS_ENDPOINT) {
      return jsonResponse({ keys: mockJwksKeys });
    }
    if (url === TOKEN_ENDPOINT) {
      if (options.body !== undefined || options.status !== undefined) {
        return jsonResponse(options.body ?? {}, { status: options.status ?? 200 });
      }
      return jsonResponse({
        token_type: "Bearer",
        access_token: "at_test",
        id_token: options.idToken,
        expires_in: 300,
      });
    }
    throw new Error(`unexpected fetch in mock: ${url}`);
  });
}

interface OidcMockProviderInternals {
  close(): Promise<void>;
  issuer: string;
  issueToken(metadata: { client_id: string; nonce?: string; scope: string }): Promise<{ id_token?: string }>;
  kid: string;
  keys: {
    publicKey: {
      export(options: { format: "jwk" }): Record<string, unknown>;
    };
  };
}

async function issueMockIdToken(options: {
  customIdTokenPayload?: Record<string, unknown>;
  nonce?: string;
  sub: string;
}) {
  const provider = (await OIDCMockProvider.create({
    hostname: "127.0.0.1",
    getTokenPayload() {
      return {
        customIdTokenPayload: options.customIdTokenPayload,
        expires_in: 300,
        payload: {
          sub: options.sub,
        },
        skipRefreshToken: true,
      };
    },
  })) as unknown as OidcMockProviderInternals;

  try {
    provider.issuer = ISSUER;
    mockJwksKeys = [
      {
        alg: "RS256",
        kid: provider.kid,
        ...provider.keys.publicKey.export({ format: "jwk" }),
      },
    ];
    const issued = await provider.issueToken({
      client_id: CLIENT_ID,
      nonce: options.nonce,
      scope: SCOPE,
    });
    if (!issued.id_token) {
      throw new Error("OIDC mock provider did not issue an id_token");
    }
    return issued.id_token;
  } finally {
    await provider.close();
  }
}

function parseSetCookie(response: Response): Map<string, { value: string; attributes: Map<string, string | true> }> {
  const cookies = new Map<string, { value: string; attributes: Map<string, string | true> }>();
  // Workers + Miniflare expose headers via getSetCookie() since hono uses it.
  const list = response.headers.getSetCookie?.() ?? [];
  for (const raw of list) {
    const segments = raw.split(";").map((part) => part.trim());
    const [first, ...rest] = segments;
    if (!first) continue;
    const eqIdx = first.indexOf("=");
    if (eqIdx === -1) continue;
    const name = first.slice(0, eqIdx);
    const value = first.slice(eqIdx + 1);
    const attributes = new Map<string, string | true>();
    for (const attr of rest) {
      if (!attr) continue;
      const idx = attr.indexOf("=");
      if (idx === -1) {
        attributes.set(attr.toLowerCase(), true);
      } else {
        attributes.set(attr.slice(0, idx).toLowerCase(), attr.slice(idx + 1));
      }
    }
    cookies.set(name, { value, attributes });
  }
  return cookies;
}

describe("worker api /api/public/admin (OIDC)", () => {
  beforeEach(async () => {
    clearOidcCachesForTesting();
    mockJwksKeys = [];
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    mockOidcCalls();
    await resetWorkerState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects /admin/start to the discovered authorize endpoint and sets the transaction cookie", async () => {
    const response = await apiRequest("/api/public/admin/start", { method: "GET" });

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const url = new URL(location ?? "");
    expect(url.origin).toBe(ISSUER);
    expect(url.pathname).toBe("/api/auth/oauth2/authorize");
    expect(fetchMock).toHaveBeenCalledWith(DISCOVERY_ENDPOINT, expect.anything());
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(`${FLAMEMAIL_ORIGIN}/api/public/admin/callback`);
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();

    const cookies = parseSetCookie(response);
    const txn = cookies.get("__Host-flamemail-oidc");
    expect(txn).toBeDefined();
    expect(txn?.attributes.get("httponly")).toBe(true);
    expect(txn?.attributes.get("secure")).toBe(true);
    expect(txn?.attributes.get("samesite")?.toString().toLowerCase()).toBe("lax");
    expect(txn?.attributes.get("path")).toBe("/");
  });

  it("redirects /admin/start to /admin?error=ADMIN_ACCESS_DISABLED when OIDC env is missing", async () => {
    const response = await apiRequest("/api/public/admin/start", {
      method: "GET",
      envOverrides: { TESSERA_OIDC_CLIENT_SECRET: "" },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/admin?error=ADMIN_ACCESS_DISABLED");
  });

  it.each([
    ["the provider is unavailable", { discoveryThrows: true }],
    [
      "a discovered endpoint violates policy",
      {
        discoveryBody: discoveryDocument({
          authorization_endpoint: "http://auth.example/api/auth/oauth2/authorize",
        }),
      },
    ],
  ] satisfies Array<[string, MockExchangeOptions]>)(
    "redirects /admin/start to /admin?error=ADMIN_ACCESS_DISABLED when discovery %s",
    async (_name, options) => {
      mockOidcCalls(options);

      const response = await apiRequest("/api/public/admin/start", { method: "GET" });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/admin?error=ADMIN_ACCESS_DISABLED");
    },
  );

  it("completes the callback, mints an admin session, and sets __Host-flamemail-admin", async () => {
    const startResponse = await apiRequest("/api/public/admin/start", { method: "GET" });
    const txnCookie = parseSetCookie(startResponse).get("__Host-flamemail-oidc")?.value;
    const startUrl = new URL(startResponse.headers.get("location") ?? "");
    const state = startUrl.searchParams.get("state") ?? "";
    const nonce = startUrl.searchParams.get("nonce") ?? "";

    const idToken = await issueMockIdToken({ sub: ALLOWED_SUB, nonce });
    mockOidcCalls({ idToken });

    const callback = await apiRequest(`/api/public/admin/callback?code=test-code&state=${encodeURIComponent(state)}`, {
      method: "GET",
      cookie: `__Host-flamemail-oidc=${txnCookie}`,
    });

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/admin");
    expect(fetchMock).toHaveBeenCalledWith(TOKEN_ENDPOINT, expect.objectContaining({ method: "POST" }));

    const callbackCookies = parseSetCookie(callback);
    const adminCookie = callbackCookies.get("__Host-flamemail-admin");
    expect(adminCookie).toBeDefined();
    expect(adminCookie?.value).toMatch(/^tok_/);
    expect(adminCookie?.attributes.get("httponly")).toBe(true);
    expect(adminCookie?.attributes.get("secure")).toBe(true);

    const txnExpired = callbackCookies.get("__Host-flamemail-oidc");
    expect(txnExpired).toBeDefined();
    expect(txnExpired?.attributes.get("max-age")).toBe("0");

    const stored = await env.SESSIONS.get(`token:${adminCookie?.value}`, "json");
    expect(stored).toEqual({ type: "admin", sub: ALLOWED_SUB });
  });

  it("redirects /admin/callback with not_operator when sub is not on the allowlist", async () => {
    const startResponse = await apiRequest("/api/public/admin/start", { method: "GET" });
    const txnCookie = parseSetCookie(startResponse).get("__Host-flamemail-oidc")?.value;
    const startUrl = new URL(startResponse.headers.get("location") ?? "");
    const state = startUrl.searchParams.get("state") ?? "";
    const nonce = startUrl.searchParams.get("nonce") ?? "";

    const idToken = await issueMockIdToken({ sub: "not-on-allowlist", nonce });
    mockOidcCalls({ idToken });

    const callback = await apiRequest(`/api/public/admin/callback?code=test-code&state=${encodeURIComponent(state)}`, {
      method: "GET",
      cookie: `__Host-flamemail-oidc=${txnCookie}`,
    });

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/admin?error=not_operator");
  });

  it("redirects /admin/callback with invalid_id_token when nonce mismatches", async () => {
    const startResponse = await apiRequest("/api/public/admin/start", { method: "GET" });
    const txnCookie = parseSetCookie(startResponse).get("__Host-flamemail-oidc")?.value;
    const startUrl = new URL(startResponse.headers.get("location") ?? "");
    const state = startUrl.searchParams.get("state") ?? "";

    const idToken = await issueMockIdToken({
      customIdTokenPayload: { nonce: "different-nonce" },
      sub: ALLOWED_SUB,
    });
    mockOidcCalls({ idToken });

    const callback = await apiRequest(`/api/public/admin/callback?code=test-code&state=${encodeURIComponent(state)}`, {
      method: "GET",
      cookie: `__Host-flamemail-oidc=${txnCookie}`,
    });

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/admin?error=invalid_id_token");
  });

  it("redirects /admin/callback with invalid_state when state mismatches", async () => {
    const startResponse = await apiRequest("/api/public/admin/start", { method: "GET" });
    const txnCookie = parseSetCookie(startResponse).get("__Host-flamemail-oidc")?.value;

    const callback = await apiRequest(`/api/public/admin/callback?code=test-code&state=tampered`, {
      method: "GET",
      cookie: `__Host-flamemail-oidc=${txnCookie}`,
    });

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/admin?error=invalid_state");
  });

  it("redirects /admin/callback with missing_state when transaction cookie is absent", async () => {
    const callback = await apiRequest(`/api/public/admin/callback?code=test-code&state=anything`, {
      method: "GET",
    });

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/admin?error=missing_state");
  });

  it("redirects /admin/callback with token_exchange_failed when tessera token endpoint returns non-OK", async () => {
    const startResponse = await apiRequest("/api/public/admin/start", { method: "GET" });
    const txnCookie = parseSetCookie(startResponse).get("__Host-flamemail-oidc")?.value;
    const startUrl = new URL(startResponse.headers.get("location") ?? "");
    const state = startUrl.searchParams.get("state") ?? "";

    mockOidcCalls({ status: 400, body: { error: "invalid_grant" } });

    const callback = await apiRequest(`/api/public/admin/callback?code=test-code&state=${encodeURIComponent(state)}`, {
      method: "GET",
      cookie: `__Host-flamemail-oidc=${txnCookie}`,
    });

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/admin?error=token_exchange_failed");
  });

  it("redirects /admin/callback with ADMIN_ACCESS_DISABLED when discovery fails before token exchange", async () => {
    const startResponse = await apiRequest("/api/public/admin/start", { method: "GET" });
    const txnCookie = parseSetCookie(startResponse).get("__Host-flamemail-oidc")?.value;
    const startUrl = new URL(startResponse.headers.get("location") ?? "");
    const state = startUrl.searchParams.get("state") ?? "";

    clearOidcCachesForTesting();
    mockOidcCalls({ discoveryStatus: 503 });

    const callback = await apiRequest(`/api/public/admin/callback?code=test-code&state=${encodeURIComponent(state)}`, {
      method: "GET",
      cookie: `__Host-flamemail-oidc=${txnCookie}`,
    });

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/admin?error=ADMIN_ACCESS_DISABLED");
    expect(fetchMock).not.toHaveBeenCalledWith(TOKEN_ENDPOINT, expect.anything());

    const callbackCookies = parseSetCookie(callback);
    expect(callbackCookies.get("__Host-flamemail-oidc")?.attributes.get("max-age")).toBe("0");
  });

  it("logout clears the admin cookie and KV record", async () => {
    const { token, cookie } = await seedAdminCookieSession();
    expect(await env.SESSIONS.get(`token:${token}`)).not.toBeNull();

    const response = await apiRequest("/api/public/admin/logout", {
      method: "POST",
      cookie,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const cookies = parseSetCookie(response);
    expect(cookies.get("__Host-flamemail-admin")?.attributes.get("max-age")).toBe("0");

    expect(await env.SESSIONS.get(`token:${token}`)).toBeNull();
  });

  it("logout rejects cross-origin requests", async () => {
    const { cookie } = await seedAdminCookieSession();

    const response = await apiRequest("/api/public/admin/logout", {
      method: "POST",
      cookie,
      origin: "https://attacker.example",
    });

    expect(response.status).toBe(403);
  });
});

describe("worker api /api/protected/admin", () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    await resetWorkerState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires the admin cookie for /admin/domains", async () => {
    const response = await apiRequest("/api/protected/admin/domains");
    expect(response.status).toBe(401);
  });

  it("rejects bearer admin tokens on /admin/domains", async () => {
    const { token } = await seedAdminCookieSession();
    const response = await apiRequest("/api/protected/admin/domains", { token });
    expect(response.status).toBe(401);
  });

  it("returns admin domains with a valid cookie", async () => {
    await seedDomain("mail.test");
    const { cookie } = await seedAdminCookieSession();

    const response = await apiRequest("/api/protected/admin/domains", { cookie });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { domains: Array<{ domain: string }> };
    expect(payload.domains.map((d) => d.domain)).toContain("mail.test");
  });

  it("fails closed when OIDC config is missing even with a valid cookie", async () => {
    const { cookie } = await seedAdminCookieSession();

    const response = await apiRequest("/api/protected/admin/domains", {
      cookie,
      envOverrides: { TESSERA_OIDC_CLIENT_SECRET: "" },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "ADMIN_ACCESS_DISABLED",
      error: "Admin access is unavailable because tessera OIDC is not configured or cannot be discovered.",
    });
  });

  it("fails closed when the issuer is plaintext non-loopback", async () => {
    const { cookie } = await seedAdminCookieSession();

    const response = await apiRequest("/api/protected/admin/domains", {
      cookie,
      envOverrides: { TESSERA_OIDC_ISSUER: "http://auth.example" },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "ADMIN_ACCESS_DISABLED",
    });
  });

  it("rejects an admin session whose sub is no longer on the allowlist", async () => {
    const { cookie } = await seedAdminCookieSession({ sub: "11111111-1111-4111-8111-111111111111" });

    const response = await apiRequest("/api/protected/admin/domains", { cookie });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("rejects an admin session when TESSERA_OPERATOR_SUBS no longer lists the session sub", async () => {
    const { cookie } = await seedAdminCookieSession();

    const response = await apiRequest("/api/protected/admin/domains", {
      cookie,
      envOverrides: { TESSERA_OPERATOR_SUBS: "22222222-2222-4222-8222-222222222222" },
    });
    expect(response.status).toBe(403);
  });

  it("rejects cross-origin POST /admin/domains with the cookie", async () => {
    const { cookie } = await seedAdminCookieSession();

    const response = await apiRequest("/api/protected/admin/domains", {
      method: "POST",
      cookie,
      origin: "https://attacker.example",
      body: { domain: "evil.test", isActive: true },
    });

    expect(response.status).toBe(403);
  });

  it("accepts same-origin POST /admin/domains with the cookie", async () => {
    const { cookie } = await seedAdminCookieSession();

    const response = await apiRequest("/api/protected/admin/domains", {
      method: "POST",
      cookie,
      body: { domain: "fresh.test", isActive: true },
    });

    expect(response.status).toBe(201);
  });
});
