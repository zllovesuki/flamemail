const BODY_PREFIX = "bodies";
const ATTACHMENT_PREFIX = "attachments";
const RAW_PREFIX = "raw";
const STORAGE_DELETE_BATCH_SIZE = 1000;
const STORAGE_EMAIL_BATCH_SIZE = 25;

function chunk<T>(items: T[], size: number) {
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

function safeFilename(filename: string | null | undefined) {
  return (filename ?? "attachment.bin").replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function getBodyStorageKey(emailId: string) {
  return `${BODY_PREFIX}/${emailId}.json`;
}

export function getRawStorageKey(emailId: string) {
  return `${RAW_PREFIX}/${emailId}.eml`;
}

export function getAttachmentStorageKey(emailId: string, attachmentId: string, filename?: string | null) {
  return `${ATTACHMENT_PREFIX}/${emailId}/${attachmentId}/${safeFilename(filename)}`;
}

export async function storeRawEmail(bucket: R2Bucket, emailId: string, rawEmail: ArrayBuffer) {
  const key = getRawStorageKey(emailId);
  await bucket.put(key, rawEmail, {
    httpMetadata: {
      contentType: "message/rfc822",
    },
  });
  return key;
}

export async function storeEmailBody(
  bucket: R2Bucket,
  emailId: string,
  payload: { text?: string | null; html?: string | null },
) {
  const key = getBodyStorageKey(emailId);
  await bucket.put(key, JSON.stringify({ text: payload.text ?? null, html: payload.html ?? null }), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
    },
  });
  return key;
}

export async function readEmailBody(bucket: R2Bucket, key: string | null) {
  if (!key) {
    return { text: null, html: null };
  }

  const object = await bucket.get(key);
  if (!object) {
    return { text: null, html: null };
  }

  const body = (await object.json()) as { text?: string | null; html?: string | null };
  return {
    text: body.text ?? null,
    html: body.html ?? null,
  };
}

export async function storeAttachment(
  bucket: R2Bucket,
  emailId: string,
  attachmentId: string,
  attachment: {
    content: ArrayBuffer;
    filename?: string | null;
    contentType?: string | null;
  },
) {
  const key = getAttachmentStorageKey(emailId, attachmentId, attachment.filename);
  await bucket.put(key, attachment.content, {
    httpMetadata: {
      contentType: attachment.contentType ?? "application/octet-stream",
    },
  });
  return key;
}

export async function deleteStorageKeys(bucket: R2Bucket, keys: Array<string | null | undefined>) {
  const filtered = [...new Set(keys.filter((key): key is string => Boolean(key)))];
  if (filtered.length === 0) {
    return;
  }

  for (const batch of chunk(filtered, STORAGE_DELETE_BATCH_SIZE)) {
    await bucket.delete(batch);
  }
}

async function listKeysByPrefix(bucket: R2Bucket, prefix: string) {
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const result = await bucket.list({ prefix, cursor });
    for (const object of result.objects) {
      keys.push(object.key);
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);

  return keys;
}

export async function deleteStorageForEmails(bucket: R2Bucket, emailIds: string[]) {
  if (emailIds.length === 0) {
    return;
  }

  for (const emailBatch of chunk(emailIds, STORAGE_EMAIL_BATCH_SIZE)) {
    const keyGroups = await Promise.all(
      emailBatch.flatMap((emailId) => [
        listKeysByPrefix(bucket, `${BODY_PREFIX}/${emailId}`),
        listKeysByPrefix(bucket, `${ATTACHMENT_PREFIX}/${emailId}/`),
        listKeysByPrefix(bucket, `${RAW_PREFIX}/${emailId}`),
      ]),
    );

    await deleteStorageKeys(bucket, keyGroups.flat());
  }
}
