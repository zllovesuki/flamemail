import { and, asc, count, desc, eq, exists, gt, inArray, lt, sql } from "drizzle-orm";
import { customAlphabet, nanoid } from "nanoid";
import { ADMIN_TEMP_INBOX_PAGE_SIZE, TEMP_MAILBOX_TTL_HOURS, type SessionRecord, type TempMailboxTtlHours } from "@/shared/contracts";
import { createDb, type Database } from "@/worker/db";
import { domains, emails, inboxes } from "@/worker/db/schema";
import { createLogger } from "@/worker/logger";
import { PublicError, decodeWebSocketTicket } from "@/worker/security";
import { deleteStorageForEmails } from "@/worker/services/storage";
import type { InboxRecord } from "@/worker/types";

const createLocalPart = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 10);
const logger = createLogger("inbox-service");

export const ADMIN_SESSION_TTL_MS = 60 * 60 * 1000;
export const WEBSOCKET_TICKET_TTL_MS = 60 * 1000;
export const EXPIRED_INBOX_CLEANUP_BATCH_SIZE = 100;
export const RESERVED_ADDRESSES = ["admin", "postmaster", "abuse", "webmaster"] as const;
const RESERVED_ADDRESS_VALUES = [...RESERVED_ADDRESSES];

function hoursToMs(hours: number) {
  return hours * 60 * 60 * 1000;
}

function getSessionTokenKey(token: string) {
  return `token:${token}`;
}

function getInboxTokenLookupKey(address: string) {
  return `inbox-token:${address}`;
}

export function isAllowedTempMailboxTtl(hours: number): hours is TempMailboxTtlHours {
  return TEMP_MAILBOX_TTL_HOURS.includes(hours as TempMailboxTtlHours);
}

function ttlHoursFromInbox(inbox: InboxRecord) {
  if (!inbox.expiresAt) {
    return null;
  }

  const ttlHours = Math.round((inbox.expiresAt.getTime() - inbox.createdAt.getTime()) / hoursToMs(1));
  return isAllowedTempMailboxTtl(ttlHours) ? ttlHours : null;
}

export function computeInboxExpiry(createdAt: Date, ttlHours: TempMailboxTtlHours) {
  return new Date(createdAt.getTime() + hoursToMs(ttlHours));
}

export async function refreshSessionToken(env: Env, token: string, session: SessionRecord, expiresAt: Date) {
  const ttlMs = expiresAt.getTime() - Date.now();
  const expirationTtl = Math.max(60, Math.ceil(ttlMs / 1000));

  await env.SESSIONS.put(getSessionTokenKey(token), JSON.stringify(session), {
    expirationTtl,
  });

  if (session.type === "user") {
    await env.SESSIONS.put(getInboxTokenLookupKey(session.address), token, {
      expirationTtl,
    });
  }
}

export async function getInboxByAddress(env: Env, address: string, db?: Database) {
  const database = db ?? createDb(env.DB);
  return database.query.inboxes.findFirst({
    where: eq(inboxes.fullAddress, address),
  });
}

export async function listActiveDomains(env: Env, db?: Database) {
  const database = db ?? createDb(env.DB);
  return database.query.domains.findMany({
    where: eq(domains.isActive, true),
    orderBy: [asc(domains.domain)],
  });
}

export async function createSessionToken(env: Env, session: SessionRecord, ttlMs: number) {
  const token = `tok_${nanoid(32)}`;
  const expirationTtl = Math.max(60, Math.ceil(ttlMs / 1000));

  await env.SESSIONS.put(getSessionTokenKey(token), JSON.stringify(session), {
    expirationTtl,
  });

  if (session.type === "user") {
    await env.SESSIONS.put(getInboxTokenLookupKey(session.address), token, {
      expirationTtl,
    });
  }

  return token;
}

export async function revokeInboxSessionToken(env: Env, address: string) {
  const lookupKey = getInboxTokenLookupKey(address);
  const token = await env.SESSIONS.get(lookupKey);

  await Promise.all([
    env.SESSIONS.delete(lookupKey),
    ...(token ? [env.SESSIONS.delete(getSessionTokenKey(token))] : []),
  ]);
}

export async function createWebSocketTicket(env: Env, address: string, session: SessionRecord) {
  const ticket = `wst_${nanoid(24)}`;

  await env.SESSIONS.put(
    `ws-ticket:${ticket}`,
    JSON.stringify({ address, session }),
    {
      expirationTtl: Math.max(30, Math.ceil(WEBSOCKET_TICKET_TTL_MS / 1000)),
    },
  );

  return ticket;
}

export async function consumeWebSocketTicket(env: Env, ticket: string | null | undefined) {
  if (!ticket) {
    return null;
  }

  const key = `ws-ticket:${ticket}`;
  const raw = await env.SESSIONS.get(key);
  if (!raw) {
    return null;
  }

  await env.SESSIONS.delete(key);
  return decodeWebSocketTicket(raw);
}

export async function createTemporaryInbox(env: Env, requestedDomain: string, ttlHours: TempMailboxTtlHours, db?: Database) {
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

export async function seedPermanentInboxesForDomains(env: Env, domainNames: string[], db?: Database) {
  if (domainNames.length === 0) {
    return;
  }

  const database = db ?? createDb(env.DB);

  const values = domainNames.flatMap((domainName) =>
    RESERVED_ADDRESSES.map((localPart) => ({
      id: nanoid(),
      localPart,
      domain: domainName,
      fullAddress: `${localPart}@${domainName}`,
      isPermanent: true,
      expiresAt: null,
    })),
  );

  if (values.length > 0) {
    await database.insert(inboxes).values(values).onConflictDoNothing();
  }
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

export async function listDomainsForAdmin(env: Env, db?: Database) {
  const database = db ?? createDb(env.DB);
  const [domainRows, inboxCounts, deletableReservedInboxCounts, emailCounts] = await Promise.all([
    database.query.domains.findMany({
      orderBy: [asc(domains.domain)],
    }),
    database
      .select({ domain: inboxes.domain, inboxCount: count() })
      .from(inboxes)
      .groupBy(inboxes.domain),
    database
      .select({ domain: inboxes.domain, inboxCount: count() })
      .from(inboxes)
      .where(and(eq(inboxes.isPermanent, true), inArray(inboxes.localPart, RESERVED_ADDRESS_VALUES)))
      .groupBy(inboxes.domain),
    database
      .select({ domain: inboxes.domain, emailCount: count(emails.id) })
      .from(inboxes)
      .leftJoin(emails, eq(emails.inboxId, inboxes.id))
      .groupBy(inboxes.domain),
  ]);

  const countByDomain = new Map(inboxCounts.map((row) => [row.domain, row.inboxCount]));
  const deletableReservedCountByDomain = new Map(
    deletableReservedInboxCounts.map((row) => [row.domain, row.inboxCount]),
  );
  const emailCountByDomain = new Map(emailCounts.map((row) => [row.domain, row.emailCount]));

  return domainRows.map((domainRow) => {
    const inboxCount = countByDomain.get(domainRow.domain) ?? 0;
    const deletableReservedInboxCount = deletableReservedCountByDomain.get(domainRow.domain) ?? 0;
    const emailCount = emailCountByDomain.get(domainRow.domain) ?? 0;

    return {
      domain: domainRow.domain,
      isActive: domainRow.isActive,
      createdAt: domainRow.createdAt,
      inboxCount,
      canDelete: inboxCount === 0 || (deletableReservedInboxCount === inboxCount && emailCount === 0),
    };
  });
}

export async function listActiveTemporaryInboxesForAdmin(
  env: Env,
  page: number,
  pageSize = ADMIN_TEMP_INBOX_PAGE_SIZE,
  db?: Database,
  hasEmails?: boolean,
) {
  const database = db ?? createDb(env.DB);
  const currentPage = Number.isFinite(page) && page >= 0 ? page : 0;
  const now = new Date();

  const whereCondition = and(
    eq(inboxes.isPermanent, false),
    gt(inboxes.expiresAt, now),
    hasEmails
      ? exists(database.select({ n: sql`1` }).from(emails).where(eq(emails.inboxId, inboxes.id)))
      : undefined,
  );

  const [items, totalRows] = await Promise.all([
    database.query.inboxes.findMany({
      where: whereCondition,
      orderBy: [desc(inboxes.createdAt)],
      limit: pageSize,
      offset: currentPage * pageSize,
    }),
    database
      .select({ total: count() })
      .from(inboxes)
      .where(whereCondition),
  ]);

  const emailCounts = items.length
    ? await database
        .select({ inboxId: emails.inboxId, emailCount: count() })
        .from(emails)
        .where(
          inArray(
            emails.inboxId,
            items.map((item) => item.id),
          ),
        )
        .groupBy(emails.inboxId)
    : [];

  const emailCountByInboxId = new Map(emailCounts.map((row) => [row.inboxId, row.emailCount]));

  logger.info("admin_temp_inboxes_listed", "Listed active temporary inboxes for admin", {
    page: currentPage,
    pageSize,
    count: items.length,
  });

  return {
    page: currentPage,
    pageSize,
    total: totalRows[0]?.total ?? 0,
    items: items.map((item) => ({
      address: item.fullAddress,
      domain: item.domain,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      ttlHours: ttlHoursFromInbox(item),
      emailCount: emailCountByInboxId.get(item.id) ?? 0,
    })),
  };
}

export async function addDomain(env: Env, domainName: string, isActive = true, db?: Database) {
  const normalizedDomain = domainName.trim().toLowerCase();
  const database = db ?? createDb(env.DB);

  const existingDomain = await database.query.domains.findFirst({
    where: eq(domains.domain, normalizedDomain),
  });

  if (existingDomain) {
    throw new PublicError("Domain already exists");
  }

  await database.insert(domains).values({
    id: nanoid(),
    domain: normalizedDomain,
    isActive,
    createdAt: new Date(),
  });

  if (isActive) {
    await seedPermanentInboxesForDomains(env, [normalizedDomain], database);
  }

  logger.info("domain_added", "Added domain to pool", {
    domain: normalizedDomain,
    isActive,
  });
}

export async function updateDomainStatus(env: Env, domainName: string, isActive: boolean, db?: Database) {
  const normalizedDomain = domainName.trim().toLowerCase();
  const database = db ?? createDb(env.DB);
  const existingDomain = await database.query.domains.findFirst({
    where: eq(domains.domain, normalizedDomain),
  });

  if (!existingDomain) {
    throw new PublicError("Domain not found");
  }

  await database.update(domains).set({ isActive }).where(eq(domains.id, existingDomain.id));

  if (isActive) {
    await seedPermanentInboxesForDomains(env, [normalizedDomain], database);
  }

  logger.info("domain_status_updated", "Updated domain availability", {
    domain: normalizedDomain,
    isActive,
  });
}

export async function deleteDomainByName(env: Env, domainName: string, db?: Database) {
  const normalizedDomain = domainName.trim().toLowerCase();
  const database = db ?? createDb(env.DB);
  const existingDomain = await database.query.domains.findFirst({
    where: eq(domains.domain, normalizedDomain),
  });

  if (!existingDomain) {
    throw new PublicError("Domain not found");
  }

  const deletableReservedInboxFilter = and(
    eq(inboxes.domain, normalizedDomain),
    eq(inboxes.isPermanent, true),
    inArray(inboxes.localPart, RESERVED_ADDRESS_VALUES),
  );
  const [totalInboxRows, deletableReservedInboxRows] = await Promise.all([
    database.select({ total: count() }).from(inboxes).where(eq(inboxes.domain, normalizedDomain)),
    database.select({ total: count() }).from(inboxes).where(deletableReservedInboxFilter),
  ]);
  const totalInboxCount = totalInboxRows[0]?.total ?? 0;
  const deletableReservedInboxCount = deletableReservedInboxRows[0]?.total ?? 0;

  if (deletableReservedInboxCount !== totalInboxCount) {
    throw new PublicError("Domain still has inboxes. Disable it instead of deleting it.");
  }

  if (deletableReservedInboxCount > 0) {
    const [emailCountRows] = await Promise.all([
        database
          .select({ total: count(emails.id) })
          .from(inboxes)
          .leftJoin(emails, eq(emails.inboxId, inboxes.id))
          .where(deletableReservedInboxFilter),
    ]);
    const emailCount = emailCountRows[0]?.total ?? 0;

    if (emailCount > 0) {
      throw new PublicError("Domain still has inboxes. Disable it instead of deleting it.");
    }

    await database.delete(inboxes).where(deletableReservedInboxFilter);
  }

  await database.delete(domains).where(eq(domains.id, existingDomain.id));

  logger.info("domain_deleted", "Deleted domain from pool", {
    domain: normalizedDomain,
  });
}

async function collectEmailIds(db: Database, inboxIds: string[]) {
  if (inboxIds.length === 0) {
    return [] as string[];
  }

  const emailRows = await db
    .select({ id: emails.id })
    .from(emails)
    .where(inArray(emails.inboxId, inboxIds));

  return emailRows.map((row) => row.id);
}

export async function deleteInbox(env: Env, inbox: InboxRecord, db?: Database) {
  if (inbox.isPermanent) {
    throw new PublicError("Permanent inboxes cannot be deleted");
  }

  const database = db ?? createDb(env.DB);
  const emailIds = await collectEmailIds(database, [inbox.id]);
  await deleteStorageForEmails(env.STORAGE, emailIds);
  await revokeInboxSessionToken(env, inbox.fullAddress);

  await database.delete(inboxes).where(eq(inboxes.id, inbox.id));

  logger.info("inbox_deleted", "Deleted inbox and associated storage", {
    address: inbox.fullAddress,
  });
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

    const expiredInboxIds = expiredInboxes.map((inbox) => inbox.id);
    const emailIds = await collectEmailIds(db, expiredInboxIds);

    await deleteStorageForEmails(env.STORAGE, emailIds);
    await Promise.all(expiredInboxes.map((inbox) => revokeInboxSessionToken(env, inbox.fullAddress)));
    await db.delete(inboxes).where(inArray(inboxes.id, expiredInboxIds));

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
