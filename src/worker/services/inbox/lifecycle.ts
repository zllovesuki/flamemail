import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { SessionRecord, TempMailboxTtlHours } from "@/shared/contracts";
import { createDb, type Database } from "@/worker/db";
import { domains, inboxes } from "@/worker/db/schema";
import { createLogger } from "@/worker/logger";
import { PublicError } from "@/worker/security";
import type { InboxRecord } from "@/worker/types";
import { purgeInboxes } from "./cleanup";
import { createSessionToken, refreshSessionToken } from "./session-store";
import { computeInboxExpiry, createLocalPart, hoursToMs, ttlHoursFromInbox } from "./shared";

const logger = createLogger("inbox-service");

export async function createTemporaryInbox(
  env: Env,
  requestedDomain: string,
  ttlHours: TempMailboxTtlHours,
  db?: Database,
) {
  const database = db ?? createDb(env.DB);
  const domainRecord = await database.query.domains.findFirst({
    where: and(eq(domains.domain, requestedDomain), eq(domains.isActive, true)),
  });

  if (!domainRecord) {
    throw new PublicError("Requested domain is not available");
  }

  let localPart = "";
  let address = "";
  let existing: InboxRecord | undefined;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    localPart = createLocalPart();
    address = `${localPart}@${requestedDomain}`;
    existing = await database.query.inboxes.findFirst({
      where: eq(inboxes.fullAddress, address),
    });

    if (!existing) {
      break;
    }
  }

  if (existing) {
    throw new PublicError("Could not create an inbox right now");
  }

  const createdAt = new Date();
  const expiresAt = computeInboxExpiry(createdAt, ttlHours);
  const inboxId = nanoid();

  await database.insert(inboxes).values({
    id: inboxId,
    localPart,
    domain: requestedDomain,
    fullAddress: address,
    isPermanent: false,
    createdAt,
    expiresAt,
  });

  const token = await createSessionToken(
    env,
    {
      type: "user",
      address,
    },
    hoursToMs(ttlHours),
  );

  logger.info("inbox_created", "Created temporary inbox", {
    address,
    domain: requestedDomain,
    ttlHours,
  });

  return {
    address,
    token,
    ttlHours,
    expiresAt,
  };
}

export async function extendTemporaryInbox(
  env: Env,
  inbox: InboxRecord,
  token: string,
  session: SessionRecord,
  ttlHours: TempMailboxTtlHours,
  db?: Database,
) {
  if (inbox.isPermanent) {
    throw new PublicError("Permanent inboxes cannot be extended");
  }

  const expiresAt = computeInboxExpiry(inbox.createdAt, ttlHours);
  const currentExpiresAt = inbox.expiresAt;

  if (!currentExpiresAt) {
    throw new PublicError("Inbox does not have an expiry to extend");
  }

  if (expiresAt.getTime() <= currentExpiresAt.getTime()) {
    throw new PublicError("Inbox already extends beyond the requested duration");
  }

  const database = db ?? createDb(env.DB);
  await database.update(inboxes).set({ expiresAt }).where(eq(inboxes.id, inbox.id));
  await refreshSessionToken(env, token, session, expiresAt);

  logger.info("inbox_extended", "Extended temporary inbox lifetime", {
    address: inbox.fullAddress,
    ttlHours,
    previousTtlHours: ttlHoursFromInbox(inbox),
  });

  return {
    expiresAt,
    ttlHours,
  };
}

export async function deleteInbox(env: Env, inbox: InboxRecord, db?: Database) {
  if (inbox.isPermanent) {
    throw new PublicError("Permanent inboxes cannot be deleted");
  }

  const database = db ?? createDb(env.DB);
  await purgeInboxes(env, [inbox], database);

  logger.info("inbox_deleted", "Deleted inbox and associated storage", {
    address: inbox.fullAddress,
  });
}
