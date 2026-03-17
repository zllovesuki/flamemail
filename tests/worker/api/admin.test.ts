import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "@/worker/db";
import { domains, inboxes } from "@/worker/db/schema";
import { apiRequest, resetWorkerState, seedDomain, seedEmail, seedInbox, seedSession } from "./helpers";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("worker api /api/public/admin and /api/protected/admin", () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    await resetWorkerState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails closed when admin access is unavailable", async () => {
    const response = await apiRequest("/api/public/admin/login", {
      body: {
        password: "AdminPassword123!#",
        turnstileToken: "turnstile-token",
      },
      envOverrides: {
        ADMIN_PASSWORD: "change-me",
      },
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "ADMIN_ACCESS_DISABLED",
      error: "Admin access is unavailable because ADMIN_PASSWORD is not configured securely.",
    });
  });

  it("rejects invalid admin login request bodies", async () => {
    const response = await apiRequest("/api/public/admin/login", {
      body: {
        password: "AdminPassword123!#",
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid login request",
    });
  });

  it("rejects admin login when turnstile verification fails", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: false,
        "error-codes": ["invalid-input-response"],
      }),
    );

    const response = await apiRequest("/api/public/admin/login", {
      body: {
        password: "AdminPassword123!#",
        turnstileToken: "turnstile-token",
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Human verification failed. Please try again.",
    });
  });

  it("rejects the wrong admin password", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        action: "test",
      }),
    );

    const response = await apiRequest("/api/public/admin/login", {
      body: {
        password: "WrongPassword123!",
        turnstileToken: "turnstile-token",
      },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid admin password",
    });
  });

  it("returns a token for the correct password", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        action: "test",
      }),
    );

    const response = await apiRequest("/api/public/admin/login", {
      body: {
        password: "AdminPassword123!#",
        turnstileToken: "turnstile-token",
      },
    });

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      token: string;
    };

    expect(payload.token).toMatch(/^tok_/);
  });

  it("requires admin auth for the domain list", async () => {
    const response = await apiRequest("/api/protected/admin/domains");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  it("forbids non-admin sessions from the domain list", async () => {
    const token = await seedSession({
      type: "user",
      address: "reader@mail.test",
    });

    const response = await apiRequest("/api/protected/admin/domains", {
      token,
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
    });
  });

  it("returns the domain list for an authenticated admin", async () => {
    await seedDomain("mail.test", true);
    await seedDomain("inactive.test", false);
    const token = await seedSession({
      type: "admin",
    });

    const response = await apiRequest("/api/protected/admin/domains", {
      token,
    });

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      domains: Array<{
        canDelete: boolean;
        createdAt: string;
        domain: string;
        inboxCount: number;
        isActive: boolean;
      }>;
    };

    expect(payload.domains).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: "inactive.test",
          isActive: false,
        }),
        expect.objectContaining({
          domain: "mail.test",
          isActive: true,
        }),
      ]),
    );
  });

  it("adds a domain for an authenticated admin", async () => {
    const token = await seedSession({
      type: "admin",
    });

    const response = await apiRequest("/api/protected/admin/domains", {
      method: "POST",
      token,
      body: {
        domain: "NewDomain.TEST",
        isActive: true,
      },
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      domains: [
        expect.objectContaining({
          domain: "newdomain.test",
          isActive: true,
          inboxCount: 4,
          canDelete: true,
        }),
      ],
    });

    const db = createDb(env.DB.withSession("first-primary"));
    const storedDomain = await db.query.domains.findFirst({
      where: (table, { eq }) => eq(table.domain, "newdomain.test"),
    });
    const permanentInboxes = await db.query.inboxes.findMany({
      where: (table, { eq }) => eq(table.domain, "newdomain.test"),
    });

    expect(storedDomain?.isActive).toBe(true);
    expect(permanentInboxes).toHaveLength(4);
  });

  it("updates domain status for an authenticated admin", async () => {
    await seedDomain("mail.test", false);
    const token = await seedSession({
      type: "admin",
    });

    const response = await apiRequest("/api/protected/admin/domains/mail.test", {
      method: "PATCH",
      token,
      body: {
        isActive: true,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const db = createDb(env.DB.withSession("first-primary"));
    const storedDomain = await db.query.domains.findFirst({
      where: (table, { eq }) => eq(table.domain, "mail.test"),
    });
    const permanentInboxes = await db.query.inboxes.findMany({
      where: (table, { eq }) => eq(table.domain, "mail.test"),
    });

    expect(storedDomain?.isActive).toBe(true);
    expect(permanentInboxes).toHaveLength(4);
  });

  it("deletes a domain when it has no blocking inboxes", async () => {
    await seedDomain("mail.test", false);
    const token = await seedSession({
      type: "admin",
    });

    const response = await apiRequest("/api/protected/admin/domains/mail.test", {
      method: "DELETE",
      token,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const db = createDb(env.DB.withSession("first-primary"));
    const storedDomain = await db.query.domains.findFirst({
      where: (table, { eq }) => eq(table.domain, "mail.test"),
    });

    expect(storedDomain).toBeUndefined();
  });

  it("lists active temporary inboxes for admin inspection", async () => {
    await seedDomain("mail.test", true);
    const inboxWithEmail = await seedInbox({
      address: "reader@mail.test",
      createdAt: new Date("2026-04-15T00:00:00.000Z"),
      expiresAt: new Date("2026-04-16T00:00:00.000Z"),
    });
    await seedInbox({
      address: "empty@mail.test",
      createdAt: new Date("2026-04-14T00:00:00.000Z"),
      expiresAt: new Date("2026-04-17T00:00:00.000Z"),
    });
    await seedEmail({
      address: inboxWithEmail.fullAddress,
      inboxId: inboxWithEmail.id,
      subject: "Hello",
    });
    const token = await seedSession({
      type: "admin",
    });

    const response = await apiRequest("/api/protected/admin/temp-inboxes?hasEmails=true&page=0", {
      token,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      inboxes: [
        expect.objectContaining({
          address: inboxWithEmail.fullAddress,
          domain: "mail.test",
          ttlHours: 24,
          emailCount: 1,
        }),
      ],
      page: 0,
      pageSize: 10,
      total: 1,
    });
  });

  it("lists permanent inboxes for admin inspection", async () => {
    await seedDomain("mail.test", true);
    const permanentInbox = await seedInbox({
      address: "admin@mail.test",
      isPermanent: true,
    });
    await seedEmail({
      address: permanentInbox.fullAddress,
      inboxId: permanentInbox.id,
      subject: "Permanent inbox email",
    });
    const token = await seedSession({
      type: "admin",
    });

    const response = await apiRequest("/api/protected/admin/inboxes", {
      token,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      inboxes: [
        expect.objectContaining({
          address: "admin@mail.test",
          domain: "mail.test",
          localPart: "admin",
          emailCount: 1,
        }),
      ],
    });
  });
});
