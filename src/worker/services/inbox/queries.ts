import { and, asc, count, desc, eq, exists, gt, inArray, sql } from "drizzle-orm";
import { ADMIN_TEMP_INBOX_PAGE_SIZE } from "@/shared/contracts";
import { createDb, type Database } from "@/worker/db";
import { domains, emails, inboxes } from "@/worker/db/schema";
import { createLogger } from "@/worker/logger";
import { ttlHoursFromInbox } from "./shared";

const logger = createLogger("inbox-service");

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

export async function collectEmailIds(db: Database, inboxIds: string[]) {
  if (inboxIds.length === 0) {
    return [] as string[];
  }

  const emailRows = await db.select({ id: emails.id }).from(emails).where(inArray(emails.inboxId, inboxIds));

  return emailRows.map((row) => row.id);
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
      ? exists(
          database
            .select({ n: sql`1` })
            .from(emails)
            .where(eq(emails.inboxId, inboxes.id)),
        )
      : undefined,
  );

  const [items, totalRows] = await Promise.all([
    database.query.inboxes.findMany({
      where: whereCondition,
      orderBy: [desc(inboxes.createdAt)],
      limit: pageSize,
      offset: currentPage * pageSize,
    }),
    database.select({ total: count() }).from(inboxes).where(whereCondition),
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
