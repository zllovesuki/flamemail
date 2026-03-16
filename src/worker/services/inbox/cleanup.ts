import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { createDb, type Database } from "@/worker/db";
import { emails, inboxes } from "@/worker/db/schema";
import { createLogger } from "@/worker/logger";
import { deleteStorageForEmails } from "@/worker/services/storage";
import type { InboxRecord } from "@/worker/types";
import { collectEmailIds } from "./queries";
import { revokeInboxSessionToken } from "./session-store";
import { EXPIRED_INBOX_CLEANUP_BATCH_SIZE } from "./shared";

const logger = createLogger("inbox-service");

export async function purgeEmailStorage(bucket: R2Bucket, emailIds: string[]) {
  await deleteStorageForEmails(bucket, emailIds);
}

export async function deleteEmailWithStorage(env: Env, emailId: string, db: Database) {
  await purgeEmailStorage(env.STORAGE, [emailId]);
  await db.delete(emails).where(eq(emails.id, emailId));
}

export async function purgeInboxes(env: Env, targetInboxes: InboxRecord[], db: Database) {
  if (targetInboxes.length === 0) {
    return;
  }

  const inboxIds = targetInboxes.map((inbox) => inbox.id);
  const emailIds = await collectEmailIds(db, inboxIds);

  await purgeEmailStorage(env.STORAGE, emailIds);
  await Promise.all(targetInboxes.map((inbox) => revokeInboxSessionToken(env, inbox.fullAddress)));
  await db.delete(inboxes).where(inArray(inboxes.id, inboxIds));
}

export async function cleanupExpiredInboxes(env: Env) {
  const db = createDb(env.DB);
  let deleted = 0;

  while (true) {
    const expiredInboxes = await db.query.inboxes.findMany({
      where: and(eq(inboxes.isPermanent, false), lt(inboxes.expiresAt, new Date())),
      orderBy: [asc(inboxes.expiresAt), asc(inboxes.id)],
      limit: EXPIRED_INBOX_CLEANUP_BATCH_SIZE,
    });

    if (expiredInboxes.length === 0) {
      break;
    }

    await purgeInboxes(env, expiredInboxes, db);

    deleted += expiredInboxes.length;

    logger.info("cleanup_completed", "Deleted expired inbox batch", {
      batchDeleted: expiredInboxes.length,
      deleted,
    });

    if (expiredInboxes.length < EXPIRED_INBOX_CLEANUP_BATCH_SIZE) {
      break;
    }
  }

  return { deleted };
}
