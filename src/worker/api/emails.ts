import { and, count, desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { EMAIL_PAGE_SIZE, EmailDetail, EmailPage, ErrorResponse, OkResponse } from "@/shared/contracts";
import { attachments, emails } from "@/worker/db/schema";
import { requireInboxAccess } from "@/worker/middleware/auth";
import { deleteStorageForEmails, getRawStorageKey, readEmailBody } from "@/worker/services/storage";
import type { AppBindings } from "@/worker/types";

function toSummary(email: Pick<typeof emails.$inferSelect, "id" | "recipientAddress" | "fromAddress" | "fromName" | "subject" | "receivedAt" | "isRead" | "hasAttachments" | "sizeBytes">) {
  return {
    id: email.id,
    recipientAddress: email.recipientAddress,
    fromAddress: email.fromAddress,
    fromName: email.fromName,
    subject: email.subject ?? "(no subject)",
    receivedAt: email.receivedAt.toISOString(),
    isRead: email.isRead,
    hasAttachments: email.hasAttachments,
    sizeBytes: email.sizeBytes ?? 0,
  };
}

export function registerEmailRoutes(app: Hono<AppBindings>) {
  app.get("/api/inboxes/:address/emails", requireInboxAccess, async (c) => {
    const inbox = c.get("inbox");
    const db = c.get("db");
    const page = Number.parseInt(c.req.query("page") ?? "0", 10);
    const includeTotal = c.req.query("includeTotal") === "1";
    const currentPage = Number.isFinite(page) && page >= 0 ? page : 0;

    const emailRows = await db
      .select({
        id: emails.id,
        recipientAddress: emails.recipientAddress,
        fromAddress: emails.fromAddress,
        fromName: emails.fromName,
        subject: emails.subject,
        receivedAt: emails.receivedAt,
        isRead: emails.isRead,
        hasAttachments: emails.hasAttachments,
        sizeBytes: emails.sizeBytes,
      })
      .from(emails)
      .where(eq(emails.inboxId, inbox.id))
      .orderBy(desc(emails.receivedAt), desc(emails.id))
      .limit(EMAIL_PAGE_SIZE)
      .offset(currentPage * EMAIL_PAGE_SIZE);

    const total = includeTotal
      ? (await db.select({ total: count() }).from(emails).where(eq(emails.inboxId, inbox.id)))[0]?.total ?? 0
      : null;

    return c.json(EmailPage.create({
      emails: emailRows.map(toSummary),
      total,
      page: currentPage,
    }));
  });

  app.get("/api/inboxes/:address/emails/:id", requireInboxAccess, async (c) => {
    const inbox = c.get("inbox");
    const session = c.get("session");
    const db = c.get("db");
    const emailId = c.req.param("id");

    const emailRecord = await db.query.emails.findFirst({
      where: and(eq(emails.id, emailId), eq(emails.inboxId, inbox.id)),
      with: {
        attachments: true,
      },
    });

    if (!emailRecord) {
      return c.json(ErrorResponse.create({ error: "Email not found" }), 404);
    }

    const body = await readEmailBody(c.env.STORAGE, emailRecord.bodyKey);
    const shouldMarkRead = session.type !== "admin";

    if (shouldMarkRead && !emailRecord.isRead) {
      await db.update(emails).set({ isRead: true }).where(eq(emails.id, emailRecord.id));
    }

    return c.json(EmailDetail.create({
      id: emailRecord.id,
      recipientAddress: emailRecord.recipientAddress,
      fromAddress: emailRecord.fromAddress,
      fromName: emailRecord.fromName,
      subject: emailRecord.subject ?? "(no subject)",
      receivedAt: emailRecord.receivedAt.toISOString(),
      isRead: shouldMarkRead ? true : emailRecord.isRead,
      hasAttachments: emailRecord.hasAttachments,
      sizeBytes: emailRecord.sizeBytes ?? 0,
      text: body.text,
      html: body.html,
      attachments: emailRecord.attachments.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes ?? 0,
      })),
    }));
  });

  app.get("/api/inboxes/:address/emails/:id/raw", requireInboxAccess, async (c) => {
    const inbox = c.get("inbox");
    const session = c.get("session");
    const db = c.get("db");
    const emailId = c.req.param("id");

    if (session.type !== "admin") {
      return c.json(ErrorResponse.create({ error: "Forbidden" }), 403);
    }

    const emailRecord = await db.query.emails.findFirst({
      where: and(eq(emails.id, emailId), eq(emails.inboxId, inbox.id)),
    });

    if (!emailRecord) {
      return c.json(ErrorResponse.create({ error: "Email not found" }), 404);
    }

    const object = await c.env.STORAGE.get(getRawStorageKey(emailRecord.id));
    if (!object?.body) {
      return c.json(ErrorResponse.create({ error: "Raw email is missing from storage" }), 404);
    }

    const headers = new Headers();
    headers.set("content-type", "message/rfc822");
    headers.set("content-disposition", `attachment; filename="email-${emailRecord.id}.eml"`);

    return new Response(object.body, {
      status: 200,
      headers,
    });
  });

  app.delete("/api/inboxes/:address/emails/:id", requireInboxAccess, async (c) => {
    const inbox = c.get("inbox");
    const session = c.get("session");
    const db = c.get("db");
    const emailId = c.req.param("id");

    if (session.type === "admin" && !inbox.isPermanent) {
      return c.json(ErrorResponse.create({ error: "Admin inspection for temporary inboxes is read-only" }), 403);
    }

    const emailRecord = await db.query.emails.findFirst({
      where: and(eq(emails.id, emailId), eq(emails.inboxId, inbox.id)),
      with: {
        attachments: true,
      },
    });

    if (!emailRecord) {
      return c.json(ErrorResponse.create({ error: "Email not found" }), 404);
    }

    await deleteStorageForEmails(c.env.STORAGE, [emailRecord.id]);
    await db.delete(emails).where(eq(emails.id, emailRecord.id));

    return c.json(OkResponse.create({ ok: true }));
  });

  app.get(
    "/api/inboxes/:address/emails/:id/attachments/:attId",
    requireInboxAccess,
    async (c) => {
      const inbox = c.get("inbox");
      const db = c.get("db");
      const emailId = c.req.param("id");
      const attachmentId = c.req.param("attId");

      const attachment = await db
        .select({
          id: attachments.id,
          filename: attachments.filename,
          contentType: attachments.contentType,
          storageKey: attachments.storageKey,
        })
        .from(attachments)
        .innerJoin(emails, eq(attachments.emailId, emails.id))
        .where(and(
          eq(attachments.id, attachmentId),
          eq(emails.id, emailId),
          eq(emails.inboxId, inbox.id),
        ))
        .limit(1);

      const attachmentRecord = attachment[0];
      if (!attachmentRecord) {
        const emailRecord = await db.query.emails.findFirst({
          where: and(eq(emails.id, emailId), eq(emails.inboxId, inbox.id)),
        });

        if (!emailRecord) {
          return c.json(ErrorResponse.create({ error: "Email not found" }), 404);
        }

        return c.json(ErrorResponse.create({ error: "Attachment not found" }), 404);
      }

      const object = await c.env.STORAGE.get(attachmentRecord.storageKey);
      if (!object?.body) {
        return c.json(ErrorResponse.create({ error: "Attachment is missing from storage" }), 404);
      }

      const headers = new Headers();
      headers.set("content-type", attachmentRecord.contentType ?? "application/octet-stream");
      headers.set(
        "content-disposition",
        `attachment; filename="${(attachmentRecord.filename ?? "attachment.bin").replace(/\"/g, "")}"`,
      );

      return new Response(object.body, {
        status: 200,
        headers,
      });
    },
  );
}
