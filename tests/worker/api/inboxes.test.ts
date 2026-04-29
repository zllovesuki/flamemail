import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "@/worker/db";
import { apiRequest, resetWorkerState, seedAdminCookieSession, seedDomain, seedInbox, seedSession } from "./helpers";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("worker api /api/public/inboxes and /api/protected/inboxes", () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    await resetWorkerState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a temporary inbox for an active domain", async () => {
    await seedDomain("mail.test");
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        action: "test",
        hostname: "mismatch.example",
      }),
    );

    const response = await apiRequest("/api/public/inboxes", {
      body: {
        domain: "mail.test",
        ttlHours: 24,
        turnstileToken: "turnstile-token",
      },
    });

    expect(response.status).toBe(201);

    const payload = (await response.json()) as {
      address: string;
      expiresAt: string;
      token: string;
      ttlHours: number;
    };

    expect(payload.address).toMatch(/@mail\.test$/);
    expect(payload.ttlHours).toBe(24);
    expect(new Date(payload.expiresAt).toISOString()).toBe(payload.expiresAt);

    const db = createDb(env.DB.withSession("first-primary"));
    const inbox = await db.query.inboxes.findFirst({
      where: (table, { eq }) => eq(table.fullAddress, payload.address),
    });

    expect(inbox?.domain).toBe("mail.test");
    expect(inbox?.isPermanent).toBe(false);
    expect(await env.SESSIONS.get(`token:${payload.token}`)).not.toBeNull();
  });

  it("rejects invalid create inbox request bodies", async () => {
    const response = await apiRequest("/api/public/inboxes", {
      body: {
        ttlHours: 24,
        turnstileToken: "turnstile-token",
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "A domain is required",
    });
  });

  it("rejects inbox creation when turnstile verification fails", async () => {
    await seedDomain("mail.test");
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: false,
        "error-codes": ["invalid-input-response"],
      }),
    );

    const response = await apiRequest("/api/public/inboxes", {
      body: {
        domain: "mail.test",
        ttlHours: 24,
        turnstileToken: "turnstile-token",
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Human verification failed. Please try again.",
    });
  });

  it("rejects inbox creation for unavailable domains", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        action: "test",
      }),
    );

    const response = await apiRequest("/api/public/inboxes", {
      body: {
        domain: "missing.test",
        ttlHours: 24,
        turnstileToken: "turnstile-token",
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Requested domain is not available",
    });
  });

  it("requires inbox auth for inbox detail", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });

    const response = await apiRequest(`/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  it("rejects the wrong user token for inbox detail", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const token = await seedSession({
      type: "user",
      address: "someone-else@mail.test",
    });

    const response = await apiRequest(`/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}`, {
      token,
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
    });
  });

  it("rejects bearer admin tokens on the user inbox class", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const token = await seedSession({ type: "admin", sub: "00000000-0000-4000-8000-000000000001" });

    const response = await apiRequest(`/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}`, {
      token,
    });

    expect(response.status).toBe(401);
  });

  it("rejects admin cookie alone on the user inbox class", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const { cookie } = await seedAdminCookieSession();

    const response = await apiRequest(`/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}`, {
      cookie,
    });

    expect(response.status).toBe(401);
  });

  it("rejects invalid session tokens for inbox detail", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });

    const response = await apiRequest(`/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}`, {
      token: "tok_missing",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  it("returns 404 when the admin-inspect inbox does not exist", async () => {
    const { cookie } = await seedAdminCookieSession();

    const response = await apiRequest(`/api/protected/inboxes/${encodeURIComponent("missing@mail.test")}?admin=1`, {
      cookie,
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Inbox not found",
    });
  });

  it("returns 410 when the requested temporary inbox has expired", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const token = await seedSession({
      type: "user",
      address: inbox.fullAddress,
    });

    const response = await apiRequest(`/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}`, {
      token,
    });

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Inbox has expired",
    });
  });

  it("returns 410 for admin-inspect on an expired inbox", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const { cookie } = await seedAdminCookieSession();

    const response = await apiRequest(`/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}?admin=1`, {
      cookie,
    });

    expect(response.status).toBe(410);
  });

  it("extends a temporary inbox for the owning user", async () => {
    await seedDomain("mail.test");
    const createdAt = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5 hours ago
    const initialExpiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000); // 24h after creation
    const expectedExpiresAt = new Date(createdAt.getTime() + 72 * 60 * 60 * 1000); // 72h after creation
    const inbox = await seedInbox({
      address: "reader@mail.test",
      createdAt,
      expiresAt: initialExpiresAt,
    });
    const token = await seedSession({
      type: "user",
      address: inbox.fullAddress,
    });

    const response = await apiRequest(`/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}/extend`, {
      method: "POST",
      token,
      body: {
        ttlHours: 72,
      },
    });

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      address: string;
      expiresAt: string;
      ttlHours: number;
    };

    expect(payload).toEqual({
      address: inbox.fullAddress,
      expiresAt: expectedExpiresAt.toISOString(),
      ttlHours: 72,
    });

    const db = createDb(env.DB.withSession("first-primary"));
    const storedInbox = await db.query.inboxes.findFirst({
      where: (table, { eq }) => eq(table.id, inbox.id),
    });

    expect(storedInbox?.expiresAt?.toISOString()).toBe(expectedExpiresAt.toISOString());
    expect(await env.SESSIONS.get(`token:${token}`)).not.toBeNull();
  });

  it("rejects inbox extension for admin inspection mode", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const { cookie } = await seedAdminCookieSession();

    const response = await apiRequest(
      `/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}/extend?admin=1`,
      {
        method: "POST",
        cookie,
        body: { ttlHours: 72 },
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Admin inspection for temporary inboxes is read-only",
    });
  });

  it("issues a websocket ticket for an authorized session", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const token = await seedSession({
      type: "user",
      address: inbox.fullAddress,
    });

    const response = await apiRequest(`/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}/ws-ticket`, {
      method: "POST",
      token,
    });

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      ticket: string;
    };

    expect(payload.ticket).toMatch(/^wst_/);
    await expect(env.SESSIONS.get(`ws-ticket:${payload.ticket}`, "json")).resolves.toEqual({
      address: inbox.fullAddress,
      session: {
        type: "user",
        address: inbox.fullAddress,
      },
    });
  });

  it("issues an admin-scoped websocket ticket via cookie + ?admin=1", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const { cookie } = await seedAdminCookieSession();

    const response = await apiRequest(
      `/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}/ws-ticket?admin=1`,
      {
        method: "POST",
        cookie,
      },
    );

    expect(response.status).toBe(200);

    const payload = (await response.json()) as { ticket: string };
    await expect(env.SESSIONS.get(`ws-ticket:${payload.ticket}`, "json")).resolves.toEqual({
      address: inbox.fullAddress,
      session: { type: "admin", sub: "00000000-0000-4000-8000-000000000001" },
    });
  });

  it("rejects cross-origin ws-ticket on admin-inspect", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const { cookie } = await seedAdminCookieSession();

    const response = await apiRequest(
      `/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}/ws-ticket?admin=1`,
      {
        method: "POST",
        cookie,
        origin: "https://attacker.example",
      },
    );

    expect(response.status).toBe(403);
  });

  it("ignores the bearer token when ?admin=1 is set", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const userToken = await seedSession({
      type: "user",
      address: inbox.fullAddress,
    });

    const response = await apiRequest(`/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}?admin=1`, {
      token: userToken,
    });

    expect(response.status).toBe(401);
  });

  it("deletes a temporary inbox for the owning user", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const token = await seedSession({
      type: "user",
      address: inbox.fullAddress,
    });

    const response = await apiRequest(`/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}`, {
      method: "DELETE",
      token,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const db = createDb(env.DB.withSession("first-primary"));
    const storedInbox = await db.query.inboxes.findFirst({
      where: (table, { eq }) => eq(table.id, inbox.id),
    });

    expect(storedInbox).toBeUndefined();
  });

  it("rejects delete for permanent inboxes via admin-inspect", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "admin@mail.test",
      isPermanent: true,
    });
    const { cookie } = await seedAdminCookieSession();

    const response = await apiRequest(`/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}?admin=1`, {
      method: "DELETE",
      cookie,
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Permanent inboxes cannot be deleted",
    });
  });

  it("admin-inspect can delete a temporary inbox", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const { cookie } = await seedAdminCookieSession();

    const response = await apiRequest(`/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}?admin=1`, {
      method: "DELETE",
      cookie,
    });

    expect(response.status).toBe(200);

    const db = createDb(env.DB.withSession("first-primary"));
    const stored = await db.query.inboxes.findFirst({
      where: (table, { eq }) => eq(table.id, inbox.id),
    });
    expect(stored).toBeUndefined();
  });

  it("bearer wins on user inbox class even when cookie is also present", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const userToken = await seedSession({
      type: "user",
      address: inbox.fullAddress,
    });
    const { cookie } = await seedAdminCookieSession();

    const response = await apiRequest(`/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}`, {
      token: userToken,
      cookie,
    });

    expect(response.status).toBe(200);
  });
});
