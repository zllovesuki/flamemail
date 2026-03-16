import { createExecutionContext, env } from "cloudflare:test";
import type { SessionRecord } from "@/shared/contracts";
import worker from "@/worker/index";
import { createDb } from "@/worker/db";
import { attachments, domains, emails, inboxes } from "@/worker/db/schema";
import { storeAttachment, storeEmailBody, storeRawEmail } from "@/worker/services/storage";

const encoder = new TextEncoder();

function getDatabase() {
  return createDb(env.DB.withSession("first-primary"));
}

function splitAddress(address: string) {
  const separatorIndex = address.indexOf("@");
  if (separatorIndex <= 0 || separatorIndex === address.length - 1) {
    throw new Error(`Invalid inbox address: ${address}`);
  }

  return {
    localPart: address.slice(0, separatorIndex),
    domain: address.slice(separatorIndex + 1),
  };
}

async function clearSessions() {
  let cursor: string | undefined;

  do {
    const result = await env.SESSIONS.list({ cursor });
    await Promise.all(result.keys.map((key) => env.SESSIONS.delete(key.name)));
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
}

async function clearStorage() {
  let cursor: string | undefined;

  do {
    const result = await env.STORAGE.list({ cursor });
    const keys = result.objects.map((object) => object.key);
    if (keys.length > 0) {
      await env.STORAGE.delete(keys);
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
}

export async function resetWorkerState() {
  const db = getDatabase();

  await clearStorage();
  await clearSessions();
  await db.delete(attachments);
  await db.delete(emails);
  await db.delete(inboxes);
  await db.delete(domains);
}

export async function seedDomain(domainName: string, isActive = true) {
  const now = new Date();
  const record = {
    id: `domain_${crypto.randomUUID()}`,
    domain: domainName,
    isActive,
    createdAt: now,
  };

  await getDatabase().insert(domains).values(record);
  return record;
}

interface SeedInboxOptions {
  address: string;
  createdAt?: Date;
  expiresAt?: Date | null;
  id?: string;
  isPermanent?: boolean;
}

export async function seedInbox(options: SeedInboxOptions) {
  const { localPart, domain } = splitAddress(options.address);
  const createdAt = options.createdAt ?? new Date();
  const defaultExpiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
  const record = {
    id: options.id ?? `inbox_${crypto.randomUUID()}`,
    localPart,
    domain,
    fullAddress: options.address,
    isPermanent: options.isPermanent ?? false,
    createdAt,
    expiresAt: (options.isPermanent ?? false) ? null : (options.expiresAt ?? defaultExpiresAt),
  };

  await getDatabase().insert(inboxes).values(record);
  return record;
}

export async function seedSession(session: SessionRecord, token = `tok_${crypto.randomUUID().replace(/-/g, "")}`) {
  await env.SESSIONS.put(`token:${token}`, JSON.stringify(session), {
    expirationTtl: 60 * 60,
  });

  if (session.type === "user") {
    await env.SESSIONS.put(`inbox-token:${session.address}`, token, {
      expirationTtl: 60 * 60,
    });
  }

  return token;
}

interface SeedAttachmentOptions {
  content: ArrayBuffer | string;
  contentType?: string | null;
  filename?: string | null;
  id?: string;
}

interface SeedEmailOptions {
  address: string;
  attachments?: SeedAttachmentOptions[];
  fromAddress?: string;
  fromName?: string | null;
  html?: string | null;
  id?: string;
  inboxId: string;
  isRead?: boolean;
  raw?: ArrayBuffer | string;
  receivedAt?: Date;
  subject?: string;
  text?: string | null;
}

function toArrayBuffer(value: ArrayBuffer | string) {
  if (typeof value === "string") {
    return encoder.encode(value).buffer;
  }

  return value;
}

export async function seedEmail(options: SeedEmailOptions) {
  const emailId = options.id ?? `email_${crypto.randomUUID()}`;
  const bodyKey = await storeEmailBody(env.STORAGE, emailId, {
    text: options.text ?? null,
    html: options.html ?? null,
  });

  await storeRawEmail(env.STORAGE, emailId, toArrayBuffer(options.raw ?? `Raw email for ${emailId}`));

  await getDatabase()
    .insert(emails)
    .values({
      id: emailId,
      inboxId: options.inboxId,
      recipientAddress: options.address,
      fromAddress: options.fromAddress ?? "sender@example.com",
      fromName: options.fromName ?? "Sender",
      subject: options.subject ?? "Test subject",
      receivedAt: options.receivedAt ?? new Date(),
      isRead: options.isRead ?? false,
      sizeBytes: typeof options.raw === "string" ? options.raw.length : 128,
      hasAttachments: (options.attachments?.length ?? 0) > 0,
      bodyKey,
    });

  const storedAttachments = [] as Array<{
    contentType: string | null;
    filename: string | null;
    id: string;
    storageKey: string;
  }>;

  for (const attachment of options.attachments ?? []) {
    const attachmentId = attachment.id ?? `attachment_${crypto.randomUUID()}`;
    const storageKey = await storeAttachment(env.STORAGE, emailId, attachmentId, {
      content: toArrayBuffer(attachment.content),
      filename: attachment.filename,
      contentType: attachment.contentType,
    });

    await getDatabase()
      .insert(attachments)
      .values({
        id: attachmentId,
        emailId,
        filename: attachment.filename ?? null,
        contentType: attachment.contentType ?? null,
        sizeBytes: typeof attachment.content === "string" ? attachment.content.length : attachment.content.byteLength,
        storageKey,
      });

    storedAttachments.push({
      id: attachmentId,
      filename: attachment.filename ?? null,
      contentType: attachment.contentType ?? null,
      storageKey,
    });
  }

  return {
    bodyKey,
    emailId,
    attachments: storedAttachments,
  };
}

interface ApiRequestOptions {
  body?: unknown;
  envOverrides?: Partial<Env>;
  headers?: HeadersInit;
  method?: string;
  token?: string;
}

export function apiRequest(path: string, options: ApiRequestOptions = {}) {
  const headers = new Headers(options.headers);

  if (options.token) {
    headers.set("authorization", `Bearer ${options.token}`);
  }

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }

  const request = new Request(`https://flamemail.devbin.tools${path}`, {
    method: options.method ?? (body ? "POST" : "GET"),
    headers,
    body,
  }) as Parameters<typeof worker.fetch>[0];

  return worker.fetch(
    request,
    {
      ...env,
      ...options.envOverrides,
    },
    createExecutionContext(),
  );
}
