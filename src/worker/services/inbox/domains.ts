import { and, asc, count, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createDb, type Database } from "@/worker/db";
import { domains, emails, inboxes } from "@/worker/db/schema";
import { createLogger } from "@/worker/logger";
import { PublicError } from "@/worker/security";
import { normalizeDomainName, RESERVED_ADDRESSES, RESERVED_ADDRESS_VALUES } from "./shared";

const logger = createLogger("inbox-service");

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

export async function listDomainsForAdmin(env: Env, db?: Database) {
  const database = db ?? createDb(env.DB);
  const [domainRows, inboxCounts, deletableReservedInboxCounts, emailCounts] = await Promise.all([
    database.query.domains.findMany({
      orderBy: [asc(domains.domain)],
    }),
    database.select({ domain: inboxes.domain, inboxCount: count() }).from(inboxes).groupBy(inboxes.domain),
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

export async function addDomain(env: Env, domainName: string, isActive = true, db?: Database) {
  const normalizedDomain = normalizeDomainName(domainName);
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
  const normalizedDomain = normalizeDomainName(domainName);
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
  const normalizedDomain = normalizeDomainName(domainName);
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
