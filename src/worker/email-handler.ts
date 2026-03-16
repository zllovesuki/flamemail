import { nanoid } from "nanoid";
import PostalMime from "postal-mime";
import { and, count, eq } from "drizzle-orm";
import { createDb } from "@/worker/db";
import { attachments, domains, emails, inboxes } from "@/worker/db/schema";
import { createLogger, errorContext } from "@/worker/logger";
import { toNewEmailNotification } from "@/worker/serializers/email";
import {
  getAttachmentStorageKey,
  getBodyStorageKey,
  storeAttachment,
  storeEmailBody,
  storeRawEmail,
  deleteStorageForEmails,
} from "@/worker/services/storage";

const logger = createLogger("email-handler");
const MAX_INBOUND_EMAIL_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_INBOUND_ATTACHMENTS = 10;
const MAX_EMAILS_PER_INBOX = 100;

function parseRecipientAddress(address: string) {
  const raw = address.trim();
  const normalized = raw.toLowerCase();
  const atIndex = normalized.indexOf("@");

  if (atIndex <= 0 || atIndex === normalized.length - 1 || normalized.indexOf("@", atIndex + 1) !== -1) {
    return null;
  }

  const localPart = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  const plusIndex = localPart.indexOf("+");
  const canonicalLocalPart = plusIndex === -1 ? localPart : localPart.slice(0, plusIndex);

  if (!canonicalLocalPart) {
    return null;
  }

  return {
    raw,
    domain,
    canonicalLocalPart,
  };
}

function toArrayBuffer(value: string | ArrayBuffer) {
  if (value instanceof ArrayBuffer) {
    return value;
  }

  return new TextEncoder().encode(value).buffer;
}

export async function handleIncomingEmail(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
  const recipient = parseRecipientAddress(message.to);

  if (!recipient) {
    logger.warn("email_rejected", "Rejected inbound email with invalid address", {
      address: message.to.trim(),
    });
    message.setReject("Invalid address");
    return;
  }

  const db = createDb(env.DB);
  const [domainRecord, inbox] = await Promise.all([
    db.query.domains.findFirst({
      where: eq(domains.domain, recipient.domain),
    }),
    db.query.inboxes.findFirst({
      where: and(eq(inboxes.localPart, recipient.canonicalLocalPart), eq(inboxes.domain, recipient.domain)),
    }),
  ]);

  if (!domainRecord?.isActive || !inbox) {
    logger.warn("email_rejected", "Rejected inbound email for missing or disabled inbox", {
      address: recipient.raw,
      canonicalAddress: `${recipient.canonicalLocalPart}@${recipient.domain}`,
      domain: recipient.domain,
    });
    message.setReject("Address not found");
    return;
  }

  if (!inbox.isPermanent && inbox.expiresAt && inbox.expiresAt.getTime() < Date.now()) {
    logger.warn("email_rejected", "Rejected inbound email for expired inbox", {
      address: recipient.raw,
      canonicalAddress: inbox.fullAddress,
    });
    message.setReject("Inbox expired");
    return;
  }

  if (message.rawSize > MAX_INBOUND_EMAIL_SIZE_BYTES) {
    logger.warn("email_rejected", "Rejected inbound email that exceeded size limit", {
      address: recipient.raw,
      canonicalAddress: inbox.fullAddress,
      sizeBytes: message.rawSize,
      maxSizeBytes: MAX_INBOUND_EMAIL_SIZE_BYTES,
    });
    message.setReject("Message too large");
    return;
  }

  const quotaRows = await db.select({ total: count() }).from(emails).where(eq(emails.inboxId, inbox.id));
  const emailCount = quotaRows[0]?.total ?? 0;

  if (emailCount >= MAX_EMAILS_PER_INBOX) {
    logger.warn("email_rejected", "Rejected inbound email for inbox quota", {
      address: recipient.raw,
      canonicalAddress: inbox.fullAddress,
      emailCount,
      maxEmailsPerInbox: MAX_EMAILS_PER_INBOX,
    });
    message.setReject("Inbox is full");
    return;
  }

  try {
    const rawEmail = await new Response(message.raw).arrayBuffer();
    const parser = new PostalMime();
    const parsed = await parser.parse(rawEmail);
    const parsedAttachments = parsed.attachments ?? [];

    if (parsedAttachments.length > MAX_INBOUND_ATTACHMENTS) {
      logger.warn("email_rejected", "Rejected inbound email with too many attachments", {
        address: recipient.raw,
        canonicalAddress: inbox.fullAddress,
        attachmentCount: parsedAttachments.length,
        maxAttachments: MAX_INBOUND_ATTACHMENTS,
      });
      message.setReject("Too many attachments");
      return;
    }

    const emailId = nanoid();
    const receivedAt = new Date();
    const bodyKey = getBodyStorageKey(emailId);
    const attachmentRecords: Array<{
      row: typeof attachments.$inferInsert;
      content: ArrayBuffer;
    }> = [];

    for (const attachment of parsedAttachments) {
      const attachmentId = nanoid();
      const content = toArrayBuffer(attachment.content);
      attachmentRecords.push({
        content,
        row: {
          id: attachmentId,
          emailId,
          filename: attachment.filename,
          contentType: attachment.mimeType,
          sizeBytes: content.byteLength,
          storageKey: getAttachmentStorageKey(emailId, attachmentId, attachment.filename),
        },
      });
    }

    const attachmentRows = attachmentRecords.map((attachment) => attachment.row);

    const batchOps = [
      db.insert(emails).values({
        id: emailId,
        inboxId: inbox.id,
        recipientAddress: recipient.raw,
        fromAddress: parsed.from?.address ?? message.from,
        fromName: parsed.from?.name ?? null,
        subject: parsed.subject ?? "(no subject)",
        receivedAt,
        sizeBytes: message.rawSize,
        hasAttachments: attachmentRecords.length > 0,
        bodyKey,
      }),
      ...(attachmentRows.length > 0 ? [db.insert(attachments).values(attachmentRows)] : []),
    ] as const;

    await db.batch(batchOps as any);

    try {
      await storeRawEmail(env.STORAGE, emailId, rawEmail);
      await storeEmailBody(env.STORAGE, emailId, {
        text: parsed.text,
        html: typeof parsed.html === "string" ? parsed.html : null,
      });

      for (const attachment of attachmentRecords) {
        await storeAttachment(env.STORAGE, emailId, attachment.row.id, {
          content: attachment.content,
          filename: attachment.row.filename,
          contentType: attachment.row.contentType,
        });
      }
    } catch (storageError) {
      const [cleanupResult, deleteResult] = await Promise.allSettled([
        deleteStorageForEmails(env.STORAGE, [emailId]),
        db.delete(emails).where(eq(emails.id, emailId)),
      ]);

      logger.error("email_storage_failed", "Failed to persist inbound email content", {
        address: recipient.raw,
        canonicalAddress: inbox.fullAddress,
        emailId,
        cleanupFailed: cleanupResult.status === "rejected",
        deleteFailed: deleteResult.status === "rejected",
        ...errorContext(storageError),
      });
      message.setReject("Could not process email");
      return;
    }

    const notification = toNewEmailNotification({
      id: emailId,
      recipientAddress: recipient.raw,
      fromAddress: parsed.from?.address ?? message.from,
      fromName: parsed.from?.name ?? null,
      subject: parsed.subject ?? "(no subject)",
      receivedAt,
      isRead: false,
      hasAttachments: attachmentRecords.length > 0,
      sizeBytes: message.rawSize,
    });

    const stub = env.INBOX_WS.getByName(inbox.fullAddress);
    ctx.waitUntil(
      (async () => {
        try {
          await stub.notifyNewEmail(notification);
        } catch (error) {
          logger.warn("email_notification_failed", "Stored inbound email but websocket notification failed", {
            address: inbox.fullAddress,
            emailId,
            ...errorContext(error),
          });
        }
      })(),
    );

    logger.info("email_stored", "Stored inbound email", {
      address: inbox.fullAddress,
      recipientAddress: recipient.raw,
      emailId,
      attachmentCount: attachmentRecords.length,
      subject: parsed.subject ?? "(no subject)",
    });
  } catch (error) {
    logger.error("email_processing_failed", "Failed to process inbound email", {
      address: recipient.raw,
      canonicalAddress: inbox.fullAddress,
      ...errorContext(error),
    });
    message.setReject("Could not process email");
  }
}
