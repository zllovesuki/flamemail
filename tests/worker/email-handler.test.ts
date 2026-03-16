import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewEmailNotification } from "@/shared/contracts";
import { createDb } from "@/worker/db";
import { attachments, emails } from "@/worker/db/schema";
import { handleIncomingEmail } from "@/worker/email-handler";
import { getRawStorageKey, readEmailBody } from "@/worker/services/storage";
import { resetWorkerState, seedDomain, seedEmail, seedInbox } from "./api/helpers";

const encoder = new TextEncoder();

function getDb() {
  return createDb(env.DB.withSession("first-primary"));
}

interface FakeMessageOptions {
  from?: string;
  raw?: string;
  rawSize?: number;
  to: string;
}

function createExecutionContextStub() {
  const waitUntilPromises: Promise<unknown>[] = [];
  const ctx = createExecutionContext();
  const originalWaitUntil = ctx.waitUntil.bind(ctx);

  ctx.waitUntil = (promise) => {
    waitUntilPromises.push(promise);
    originalWaitUntil(promise);
  };

  return {
    ctx,
    waitUntilPromises,
  };
}

function createMessage(options: FakeMessageOptions) {
  const rejectReasons: string[] = [];
  const raw =
    options.raw ??
    buildMimeMessage({
      from: options.from ?? "sender@example.com",
      to: options.to,
      subject: "Test subject",
      text: "Plain text body",
    });
  const rawBytes = encoder.encode(raw);
  const message: ForwardableEmailMessage = {
    from: options.from ?? "sender@example.com",
    forward: vi.fn<(rcptTo: string, headers?: Headers) => Promise<EmailSendResult>>().mockResolvedValue({
      messageId: "forwarded",
    }),
    headers: new Headers(),
    raw: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(rawBytes);
        controller.close();
      },
    }),
    rawSize: options.rawSize ?? rawBytes.byteLength,
    reply: vi.fn<(message: EmailMessage) => Promise<EmailSendResult>>().mockResolvedValue({
      messageId: "reply",
    }),
    setReject(reason: string) {
      rejectReasons.push(reason);
    },
    to: options.to,
  };

  return {
    message,
    rejectReasons,
  };
}

function mockInboxWebSocketNotification(
  address: string,
  implementation?: (payload: NewEmailNotification) => Promise<void>,
) {
  const stub = env.INBOX_WS.getByName(address);
  const notifyNewEmail = vi.spyOn(stub, "notifyNewEmail");

  if (implementation) {
    notifyNewEmail.mockImplementation(implementation);
  } else {
    notifyNewEmail.mockResolvedValue(undefined);
  }

  vi.spyOn(env.INBOX_WS, "getByName").mockReturnValue(stub);

  return notifyNewEmail;
}

function buildMimeMessage(options: {
  attachments?: Array<{
    content: string;
    contentType: string;
    filename: string;
  }>;
  from: string;
  html?: string;
  subject: string;
  text?: string;
  to: string;
}) {
  const attachments = options.attachments ?? [];
  const hasText = typeof options.text === "string" && options.text.length > 0;
  const hasHtml = typeof options.html === "string" && options.html.length > 0;

  if (attachments.length === 0 && hasText && !hasHtml) {
    return [
      `From: <${options.from}>`,
      `To: <${options.to}>`,
      `Subject: ${options.subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      options.text,
      "",
    ].join("\r\n");
  }

  const mixedBoundary = "mixed_boundary";
  const alternativeBoundary = "alt_boundary";
  const parts: string[] = [];

  if (hasText || hasHtml) {
    if (hasText && hasHtml) {
      parts.push(
        [
          `--${mixedBoundary}`,
          `Content-Type: multipart/alternative; boundary=\"${alternativeBoundary}\"`,
          "",
          `--${alternativeBoundary}`,
          "Content-Type: text/plain; charset=utf-8",
          "Content-Transfer-Encoding: 7bit",
          "",
          options.text,
          `--${alternativeBoundary}`,
          "Content-Type: text/html; charset=utf-8",
          "Content-Transfer-Encoding: 7bit",
          "",
          options.html,
          `--${alternativeBoundary}--`,
        ].join("\r\n"),
      );
    } else if (hasText) {
      parts.push(
        [
          `--${mixedBoundary}`,
          "Content-Type: text/plain; charset=utf-8",
          "Content-Transfer-Encoding: 7bit",
          "",
          options.text,
        ].join("\r\n"),
      );
    } else if (hasHtml) {
      parts.push(
        [
          `--${mixedBoundary}`,
          "Content-Type: text/html; charset=utf-8",
          "Content-Transfer-Encoding: 7bit",
          "",
          options.html,
        ].join("\r\n"),
      );
    }
  }

  for (const attachment of attachments) {
    parts.push(
      [
        `--${mixedBoundary}`,
        `Content-Type: ${attachment.contentType}; name=\"${attachment.filename}\"`,
        `Content-Disposition: attachment; filename=\"${attachment.filename}\"`,
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(attachment.content, "utf8").toString("base64"),
      ].join("\r\n"),
    );
  }

  parts.push(`--${mixedBoundary}--`);

  return [
    `From: <${options.from}>`,
    `To: <${options.to}>`,
    `Subject: ${options.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary=\"${mixedBoundary}\"`,
    "",
    parts.join("\r\n"),
    "",
  ].join("\r\n");
}

describe("worker email handler", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetWorkerState();
  });

  it("rejects invalid recipient addresses", async () => {
    const { ctx } = createExecutionContextStub();
    const { message, rejectReasons } = createMessage({
      to: "not-an-email",
    });

    await handleIncomingEmail(message, env, ctx);

    expect(rejectReasons).toEqual(["Invalid address"]);
  });

  it("rejects messages for missing or inactive domains", async () => {
    await seedDomain("inactive.test", false);
    const { ctx: missingCtx } = createExecutionContextStub();
    const missing = createMessage({ to: "reader@missing.test" });
    const { ctx: inactiveCtx } = createExecutionContextStub();
    const inactive = createMessage({ to: "reader@inactive.test" });

    await handleIncomingEmail(missing.message, env, missingCtx);
    await handleIncomingEmail(inactive.message, env, inactiveCtx);

    expect(missing.rejectReasons).toEqual(["Address not found"]);
    expect(inactive.rejectReasons).toEqual(["Address not found"]);
  });

  it("rejects messages when the inbox does not exist", async () => {
    await seedDomain("mail.test", true);
    const { ctx } = createExecutionContextStub();
    const { message, rejectReasons } = createMessage({
      to: "reader@mail.test",
    });

    await handleIncomingEmail(message, env, ctx);

    expect(rejectReasons).toEqual(["Address not found"]);
  });

  it("rejects messages for expired temporary inboxes", async () => {
    await seedDomain("mail.test", true);
    await seedInbox({
      address: "reader@mail.test",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const { ctx } = createExecutionContextStub();
    const { message, rejectReasons } = createMessage({
      to: "reader@mail.test",
    });

    await handleIncomingEmail(message, env, ctx);

    expect(rejectReasons).toEqual(["Inbox expired"]);
  });

  it("rejects oversize messages", async () => {
    await seedDomain("mail.test", true);
    await seedInbox({
      address: "reader@mail.test",
    });
    const { ctx } = createExecutionContextStub();
    const { message, rejectReasons } = createMessage({
      to: "reader@mail.test",
      rawSize: 10 * 1024 * 1024 + 1,
    });

    await handleIncomingEmail(message, env, ctx);

    expect(rejectReasons).toEqual(["Message too large"]);
  });

  it("rejects inboxes that are over quota", async () => {
    await seedDomain("mail.test", true);
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });

    for (let index = 0; index < 100; index += 1) {
      await seedEmail({
        id: `email-${index}`,
        address: inbox.fullAddress,
        inboxId: inbox.id,
      });
    }

    const { ctx } = createExecutionContextStub();
    const { message, rejectReasons } = createMessage({
      to: "reader@mail.test",
    });

    await handleIncomingEmail(message, env, ctx);

    expect(rejectReasons).toEqual(["Inbox is full"]);
  });

  it("rejects messages with too many attachments", async () => {
    await seedDomain("mail.test", true);
    await seedInbox({
      address: "reader@mail.test",
    });
    const attachments = Array.from({ length: 11 }, (_, index) => ({
      filename: `attachment-${index}.txt`,
      contentType: "text/plain",
      content: `attachment-${index}`,
    }));
    const { ctx } = createExecutionContextStub();
    const { message, rejectReasons } = createMessage({
      to: "reader@mail.test",
      raw: buildMimeMessage({
        from: "sender@example.com",
        to: "reader@mail.test",
        subject: "Too many attachments",
        text: "Hello",
        attachments,
      }),
    });

    await handleIncomingEmail(message, env, ctx);

    expect(rejectReasons).toEqual(["Too many attachments"]);
  });

  it("stores raw email, parsed body, attachment metadata, and R2 objects", async () => {
    await seedDomain("mail.test", true);
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const notifyNewEmail = mockInboxWebSocketNotification(inbox.fullAddress);
    const { ctx, waitUntilPromises } = createExecutionContextStub();
    const { message, rejectReasons } = createMessage({
      to: "reader@mail.test",
      raw: buildMimeMessage({
        from: "sender@example.com",
        to: "reader@mail.test",
        subject: "Stored message",
        text: "Plain text body",
        html: "<p>HTML body</p>",
        attachments: [
          {
            filename: "invoice.txt",
            contentType: "text/plain",
            content: "attachment body",
          },
        ],
      }),
    });

    await handleIncomingEmail(message, env, ctx);
    await Promise.allSettled(waitUntilPromises);

    expect(rejectReasons).toEqual([]);

    const storedEmail = await getDb().query.emails.findFirst({
      where: (table, { eq }) => eq(table.inboxId, inbox.id),
    });
    const storedAttachments = await getDb().query.attachments.findMany({
      where: (table, { eq }) => eq(table.emailId, storedEmail?.id ?? "missing"),
    });
    const storedBody = await readEmailBody(env.STORAGE, storedEmail?.bodyKey ?? null);

    expect(storedEmail?.recipientAddress).toBe("reader@mail.test");
    expect(storedEmail?.subject).toBe("Stored message");
    expect(storedEmail?.hasAttachments).toBe(true);
    expect(storedBody).toEqual({
      text: "Plain text body\n",
      html: "<p>HTML body</p>\n",
    });
    expect(storedAttachments).toHaveLength(1);
    expect(await env.STORAGE.get(getRawStorageKey(storedEmail?.id ?? "missing"))).not.toBeNull();
    expect(await env.STORAGE.get(storedAttachments[0]?.storageKey ?? "missing")).not.toBeNull();
    expect(notifyNewEmail).toHaveBeenCalledTimes(1);
  });

  it("routes plus aliases to the base inbox while preserving the delivered recipient address", async () => {
    await seedDomain("mail.test", true);
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    mockInboxWebSocketNotification(inbox.fullAddress);
    const { ctx, waitUntilPromises } = createExecutionContextStub();
    const { message, rejectReasons } = createMessage({
      to: "Reader+tag@mail.test",
    });

    await handleIncomingEmail(message, env, ctx);
    await Promise.allSettled(waitUntilPromises);

    const storedEmail = await getDb().query.emails.findFirst({
      where: (table, { eq }) => eq(table.inboxId, inbox.id),
    });

    expect(rejectReasons).toEqual([]);
    expect(storedEmail?.recipientAddress).toBe("Reader+tag@mail.test");
  });

  it("cleans up and rejects the message when storage persistence fails", async () => {
    await seedDomain("mail.test", true);
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    vi.spyOn(env.STORAGE, "put").mockRejectedValueOnce(new Error("storage failed"));
    const { ctx } = createExecutionContextStub();
    const { message, rejectReasons } = createMessage({
      to: "reader@mail.test",
    });

    await handleIncomingEmail(message, env, ctx);

    const storedEmail = await getDb().query.emails.findFirst({
      where: (table, { eq }) => eq(table.inboxId, inbox.id),
    });
    const storedAttachmentRows = await getDb().select().from(attachments);

    expect(rejectReasons).toEqual(["Could not process email"]);
    expect(storedEmail).toBeUndefined();
    expect(storedAttachmentRows).toHaveLength(0);
  });

  it("does not roll back successful storage when websocket notification fails", async () => {
    await seedDomain("mail.test", true);
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    mockInboxWebSocketNotification(inbox.fullAddress, async () => {
      throw new Error("notify failed");
    });
    const { ctx, waitUntilPromises } = createExecutionContextStub();
    const { message, rejectReasons } = createMessage({
      to: "reader@mail.test",
    });

    await handleIncomingEmail(message, env, ctx);
    await Promise.allSettled(waitUntilPromises);

    const storedEmailRows = await getDb().select().from(emails);

    expect(rejectReasons).toEqual([]);
    expect(storedEmailRows).toHaveLength(1);
  });
});
