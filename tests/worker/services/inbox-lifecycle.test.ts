import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/worker/db";
import { domains, inboxes } from "@/worker/db/schema";
import {
  addDomain,
  createTemporaryInbox,
  deleteDomainByName,
  deleteInbox,
  extendTemporaryInbox,
  updateDomainStatus,
} from "@/worker/services/inbox";
import { PublicError } from "@/worker/security";
import { resetWorkerState, seedDomain, seedEmail, seedInbox, seedSession } from "../api/helpers";

function getDb() {
  return createDb(env.DB.withSession("first-primary"));
}

describe("worker inbox lifecycle services", () => {
  beforeEach(async () => {
    await resetWorkerState();
  });

  it("creates a temporary inbox on an active domain", async () => {
    await seedDomain("mail.test", true);

    const result = await createTemporaryInbox(env, "mail.test", 48, getDb());

    expect(result.address).toMatch(/@mail\.test$/);
    expect(result.ttlHours).toBe(48);
    expect(result.token).toMatch(/^tok_/);

    const storedInbox = await getDb().query.inboxes.findFirst({
      where: (table, { eq }) => eq(table.fullAddress, result.address),
    });

    expect(storedInbox?.isPermanent).toBe(false);
    expect(storedInbox?.expiresAt?.toISOString()).toBe(result.expiresAt.toISOString());
  });

  it("rejects inbox creation for inactive or missing domains", async () => {
    await seedDomain("inactive.test", false);

    await expect(createTemporaryInbox(env, "inactive.test", 24, getDb())).rejects.toThrowError(PublicError);
    await expect(createTemporaryInbox(env, "missing.test", 24, getDb())).rejects.toThrow(
      "Requested domain is not available",
    );
  });

  it("extends a temporary inbox forward only", async () => {
    await seedDomain("mail.test", true);
    const inbox = await seedInbox({
      address: "reader@mail.test",
      createdAt: new Date("2026-04-15T00:00:00.000Z"),
      expiresAt: new Date("2026-04-16T00:00:00.000Z"),
    });
    const token = await seedSession({
      type: "user",
      address: inbox.fullAddress,
    });

    const result = await extendTemporaryInbox(
      env,
      inbox,
      token,
      {
        type: "user",
        address: inbox.fullAddress,
      },
      72,
      getDb(),
    );

    expect(result).toEqual({
      expiresAt: new Date("2026-04-18T00:00:00.000Z"),
      ttlHours: 72,
    });

    const storedInbox = await getDb().query.inboxes.findFirst({
      where: (table, { eq }) => eq(table.id, inbox.id),
    });

    expect(storedInbox?.expiresAt?.toISOString()).toBe("2026-04-18T00:00:00.000Z");
  });

  it("rejects extension for permanent inboxes or non-forward ttl values", async () => {
    const permanentInbox = await seedInbox({
      address: "admin@mail.test",
      isPermanent: true,
    });
    const temporaryInbox = await seedInbox({
      address: "reader@mail.test",
      createdAt: new Date("2026-04-15T00:00:00.000Z"),
      expiresAt: new Date("2026-04-17T00:00:00.000Z"),
    });

    await expect(
      extendTemporaryInbox(env, permanentInbox, "tok_admin", { type: "admin" }, 72, getDb()),
    ).rejects.toThrow("Permanent inboxes cannot be extended");

    await expect(
      extendTemporaryInbox(
        env,
        temporaryInbox,
        "tok_user",
        { type: "user", address: temporaryInbox.fullAddress },
        48,
        getDb(),
      ),
    ).rejects.toThrow("Inbox already extends beyond the requested duration");
  });

  it("deletes temporary inboxes and revokes user sessions", async () => {
    await seedDomain("mail.test", true);
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });
    const token = await seedSession({
      type: "user",
      address: inbox.fullAddress,
    });
    await seedEmail({
      address: inbox.fullAddress,
      inboxId: inbox.id,
      attachments: [
        {
          filename: "invoice.txt",
          contentType: "text/plain",
          content: "attachment body",
        },
      ],
    });

    await deleteInbox(env, inbox, getDb());

    const storedInbox = await getDb().query.inboxes.findFirst({
      where: (table, { eq }) => eq(table.id, inbox.id),
    });

    expect(storedInbox).toBeUndefined();
    expect(await env.SESSIONS.get(`token:${token}`)).toBeNull();
    expect(await env.SESSIONS.get(`inbox-token:${inbox.fullAddress}`)).toBeNull();
  });

  it("rejects delete for permanent inboxes", async () => {
    const inbox = await seedInbox({
      address: "admin@mail.test",
      isPermanent: true,
    });

    await expect(deleteInbox(env, inbox, getDb())).rejects.toThrow("Permanent inboxes cannot be deleted");
  });

  it("adds a domain and seeds reserved permanent inboxes when active", async () => {
    await addDomain(env, "NewDomain.TEST", true, getDb());

    const storedDomain = await getDb().query.domains.findFirst({
      where: (table, { eq }) => eq(table.domain, "newdomain.test"),
    });
    const domainInboxes = await getDb().query.inboxes.findMany({
      where: (table, { eq }) => eq(table.domain, "newdomain.test"),
    });

    expect(storedDomain?.isActive).toBe(true);
    expect(domainInboxes.map((item) => item.localPart).sort()).toEqual(["abuse", "admin", "postmaster", "webmaster"]);
  });

  it("does not duplicate reserved inboxes when re-enabling a domain", async () => {
    await seedDomain("mail.test", false);

    await updateDomainStatus(env, "mail.test", true, getDb());
    await updateDomainStatus(env, "mail.test", false, getDb());
    await updateDomainStatus(env, "mail.test", true, getDb());

    const domainInboxes = await getDb().query.inboxes.findMany({
      where: (table, { eq }) => eq(table.domain, "mail.test"),
    });

    expect(domainInboxes).toHaveLength(4);
  });

  it("disables a domain without deleting existing inboxes", async () => {
    await seedDomain("mail.test", true);
    await seedInbox({
      address: "reader@mail.test",
    });

    await updateDomainStatus(env, "mail.test", false, getDb());

    const storedDomain = await getDb().query.domains.findFirst({
      where: (table, { eq }) => eq(table.domain, "mail.test"),
    });
    const storedInbox = await getDb().query.inboxes.findFirst({
      where: (table, { eq }) => eq(table.fullAddress, "reader@mail.test"),
    });

    expect(storedDomain?.isActive).toBe(false);
    expect(storedInbox?.fullAddress).toBe("reader@mail.test");
  });

  it("refuses to delete domains that still have non-deletable inboxes or reserved inbox email", async () => {
    await seedDomain("mail.test", true);
    await seedInbox({
      address: "reader@mail.test",
    });

    await expect(deleteDomainByName(env, "mail.test", getDb())).rejects.toThrow(
      "Domain still has inboxes. Disable it instead of deleting it.",
    );

    await resetWorkerState();
    await seedDomain("mail.test", true);
    const reservedInbox = await seedInbox({
      address: "admin@mail.test",
      isPermanent: true,
    });
    await seedEmail({
      address: reservedInbox.fullAddress,
      inboxId: reservedInbox.id,
    });

    await expect(deleteDomainByName(env, "mail.test", getDb())).rejects.toThrow(
      "Domain still has inboxes. Disable it instead of deleting it.",
    );
  });

  it("allows domain delete when only reserved inboxes remain with zero emails", async () => {
    await seedDomain("mail.test", true);
    await seedInbox({
      address: "admin@mail.test",
      isPermanent: true,
    });
    await seedInbox({
      address: "postmaster@mail.test",
      isPermanent: true,
    });
    await seedInbox({
      address: "abuse@mail.test",
      isPermanent: true,
    });
    await seedInbox({
      address: "webmaster@mail.test",
      isPermanent: true,
    });

    await deleteDomainByName(env, "mail.test", getDb());

    const storedDomain = await getDb().query.domains.findFirst({
      where: (table, { eq }) => eq(table.domain, "mail.test"),
    });
    const remainingInboxes = await getDb().query.inboxes.findMany({
      where: (table, { eq }) => eq(table.domain, "mail.test"),
    });

    expect(storedDomain).toBeUndefined();
    expect(remainingInboxes).toHaveLength(0);
  });
});
