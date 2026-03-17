import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/worker/db";
import { emails } from "@/worker/db/schema";
import { getRawStorageKey } from "@/worker/services/storage";
import { apiRequest, resetWorkerState, seedDomain, seedEmail, seedInbox, seedSession } from "./helpers";

describe("worker api /api/protected/inboxes/:address/emails", () => {
  beforeEach(async () => {
    await resetWorkerState();
  });

  it("returns a paginated email listing with totals", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const token = await seedSession({
      type: "user",
      address: inbox.fullAddress,
    });

    await seedEmail({
      id: "email-oldest",
      address: inbox.fullAddress,
      inboxId: inbox.id,
      subject: "Oldest",
      receivedAt: new Date("2026-03-15T10:00:00.000Z"),
    });
    await seedEmail({
      id: "email-middle",
      address: inbox.fullAddress,
      inboxId: inbox.id,
      subject: "Middle",
      receivedAt: new Date("2026-03-15T11:00:00.000Z"),
      isRead: true,
    });
    await seedEmail({
      id: "email-latest",
      address: inbox.fullAddress,
      inboxId: inbox.id,
      subject: "Latest",
      receivedAt: new Date("2026-03-15T12:00:00.000Z"),
      attachments: [
        {
          filename: "invoice.txt",
          contentType: "text/plain",
          content: "attachment body",
        },
      ],
    });

    const response = await apiRequest(
      `/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}/emails?includeTotal=1&page=0`,
      {
        token,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      emails: [
        expect.objectContaining({
          id: "email-latest",
          subject: "Latest",
          isRead: false,
          hasAttachments: true,
        }),
        expect.objectContaining({
          id: "email-middle",
          subject: "Middle",
          isRead: true,
          hasAttachments: false,
        }),
        expect.objectContaining({
          id: "email-oldest",
          subject: "Oldest",
          isRead: false,
          hasAttachments: false,
        }),
      ],
      total: 3,
      page: 0,
    });
  });

  it("marks an email as read when a user fetches the detail view", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const token = await seedSession({
      type: "user",
      address: inbox.fullAddress,
    });
    const seededEmail = await seedEmail({
      address: inbox.fullAddress,
      inboxId: inbox.id,
      text: "Plain text body",
      html: "<p>HTML body</p>",
      isRead: false,
    });

    const response = await apiRequest(
      `/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}/emails/${seededEmail.emailId}`,
      {
        token,
      },
    );

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      html: string | null;
      id: string;
      isRead: boolean;
      text: string | null;
    };

    expect(payload.id).toBe(seededEmail.emailId);
    expect(payload.text).toBe("Plain text body");
    expect(payload.html).toBe("<p>HTML body</p>");
    expect(payload.isRead).toBe(true);

    const db = createDb(env.DB.withSession("first-primary"));
    const updatedEmail = await db.query.emails.findFirst({
      where: (table, { eq }) => eq(table.id, seededEmail.emailId),
    });

    expect(updatedEmail?.isRead).toBe(true);
  });

  it("does not mark an email as read when an admin fetches the detail view", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const token = await seedSession({
      type: "admin",
    });
    const seededEmail = await seedEmail({
      address: inbox.fullAddress,
      inboxId: inbox.id,
      text: "Plain text body",
      isRead: false,
    });

    const response = await apiRequest(
      `/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}/emails/${seededEmail.emailId}`,
      {
        token,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        id: seededEmail.emailId,
        isRead: false,
        text: "Plain text body",
      }),
    );

    const db = createDb(env.DB.withSession("first-primary"));
    const storedEmail = await db.query.emails.findFirst({
      where: (table, { eq }) => eq(table.id, seededEmail.emailId),
    });

    expect(storedEmail?.isRead).toBe(false);
  });

  it("returns 404 for a missing email detail", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const token = await seedSession({
      type: "user",
      address: inbox.fullAddress,
    });

    const response = await apiRequest(
      `/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}/emails/missing-email`,
      {
        token,
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Email not found",
    });
  });

  it("rejects raw email download for non-admin sessions", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const token = await seedSession({
      type: "user",
      address: inbox.fullAddress,
    });
    const seededEmail = await seedEmail({
      address: inbox.fullAddress,
      inboxId: inbox.id,
      raw: "Raw MIME content",
    });

    const response = await apiRequest(
      `/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}/emails/${seededEmail.emailId}/raw`,
      {
        token,
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
    });
  });

  it("returns raw email content for admin sessions", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const token = await seedSession({
      type: "admin",
    });
    const seededEmail = await seedEmail({
      address: inbox.fullAddress,
      inboxId: inbox.id,
      raw: "Raw MIME content",
    });

    const response = await apiRequest(
      `/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}/emails/${seededEmail.emailId}/raw`,
      {
        token,
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("message/rfc822");
    expect(response.headers.get("content-disposition")).toContain(`email-${seededEmail.emailId}.eml`);
    await expect(response.text()).resolves.toBe("Raw MIME content");
  });

  it("rejects temporary inbox email deletion in admin inspection mode", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const token = await seedSession({
      type: "admin",
    });
    const seededEmail = await seedEmail({
      address: inbox.fullAddress,
      inboxId: inbox.id,
    });

    const response = await apiRequest(
      `/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}/emails/${seededEmail.emailId}`,
      {
        method: "DELETE",
        token,
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Admin inspection for temporary inboxes is read-only",
    });
  });

  it("deletes an email and its stored objects for the owning user", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const token = await seedSession({
      type: "user",
      address: inbox.fullAddress,
    });
    const seededEmail = await seedEmail({
      address: inbox.fullAddress,
      inboxId: inbox.id,
      text: "Plain text body",
      attachments: [
        {
          filename: "invoice.txt",
          contentType: "text/plain",
          content: "attachment body",
        },
      ],
    });

    const response = await apiRequest(
      `/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}/emails/${seededEmail.emailId}`,
      {
        method: "DELETE",
        token,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const db = createDb(env.DB.withSession("first-primary"));
    const deletedEmail = await db.query.emails.findFirst({
      where: (table, { eq }) => eq(table.id, seededEmail.emailId),
    });

    expect(deletedEmail).toBeUndefined();
    expect(await env.STORAGE.get(seededEmail.bodyKey)).toBeNull();
    expect(await env.STORAGE.get(getRawStorageKey(seededEmail.emailId))).toBeNull();
    expect(await env.STORAGE.get(seededEmail.attachments[0]?.storageKey ?? "missing")).toBeNull();
  });

  it("returns attachment content when present", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const token = await seedSession({
      type: "user",
      address: inbox.fullAddress,
    });
    const seededEmail = await seedEmail({
      address: inbox.fullAddress,
      inboxId: inbox.id,
      attachments: [
        {
          filename: "invoice.txt",
          contentType: "text/plain",
          content: "attachment body",
        },
      ],
    });

    const response = await apiRequest(
      `/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}/emails/${seededEmail.emailId}/attachments/${seededEmail.attachments[0]?.id}`,
      {
        token,
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(response.headers.get("content-disposition")).toContain("invoice.txt");
    await expect(response.text()).resolves.toBe("attachment body");
  });

  it("returns 404 for a missing attachment on an existing email", async () => {
    await seedDomain("mail.test");
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const token = await seedSession({
      type: "user",
      address: inbox.fullAddress,
    });
    const seededEmail = await seedEmail({
      address: inbox.fullAddress,
      inboxId: inbox.id,
    });

    const response = await apiRequest(
      `/api/protected/inboxes/${encodeURIComponent(inbox.fullAddress)}/emails/${seededEmail.emailId}/attachments/missing-attachment`,
      {
        token,
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Attachment not found",
    });
  });
});
