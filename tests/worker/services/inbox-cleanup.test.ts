import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "@/worker/db";
import { cleanupExpiredInboxes } from "@/worker/services/inbox";
import { getRawStorageKey } from "@/worker/services/storage";
import { resetWorkerState, seedDomain, seedEmail, seedInbox, seedSession } from "../api/helpers";

function getDb() {
  return createDb(env.DB.withSession("first-primary"));
}

describe("worker inbox cleanup service", () => {
  beforeEach(async () => {
    await resetWorkerState();
  });

  it("deletes expired temporary inboxes in batches", async () => {
    await seedDomain("mail.test", true);

    for (let index = 0; index < 101; index += 1) {
      await seedInbox({
        address: `user${index}@mail.test`,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: new Date("2026-01-02T00:00:00.000Z"),
      });
    }

    const result = await cleanupExpiredInboxes(env);
    const remaining = await getDb().query.inboxes.findMany();

    expect(result).toEqual({ deleted: 101 });
    expect(remaining).toHaveLength(0);
  });

  it("revokes session tokens and deletes storage before D1 rows", async () => {
    await seedDomain("mail.test", true);
    const inbox = await seedInbox({
      address: "reader@mail.test",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const token = await seedSession({
      type: "user",
      address: inbox.fullAddress,
    });
    const seededEmail = await seedEmail({
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

    const originalDelete = env.STORAGE.delete.bind(env.STORAGE);
    let sawEmailRowDuringStorageDelete = false;
    const deleteSpy = vi.spyOn(env.STORAGE, "delete").mockImplementation(async (keys) => {
      const emailRow = await getDb().query.emails.findFirst({
        where: (table, { eq }) => eq(table.id, seededEmail.emailId),
      });
      sawEmailRowDuringStorageDelete = emailRow !== undefined;
      await originalDelete(keys);
    });

    const result = await cleanupExpiredInboxes(env);

    deleteSpy.mockRestore();

    const storedInbox = await getDb().query.inboxes.findFirst({
      where: (table, { eq }) => eq(table.id, inbox.id),
    });
    const storedEmail = await getDb().query.emails.findFirst({
      where: (table, { eq }) => eq(table.id, seededEmail.emailId),
    });

    expect(result).toEqual({ deleted: 1 });
    expect(sawEmailRowDuringStorageDelete).toBe(true);
    expect(storedInbox).toBeUndefined();
    expect(storedEmail).toBeUndefined();
    expect(await env.SESSIONS.get(`token:${token}`)).toBeNull();
    expect(await env.SESSIONS.get(`inbox-token:${inbox.fullAddress}`)).toBeNull();
    expect(await env.STORAGE.get(seededEmail.bodyKey)).toBeNull();
    expect(await env.STORAGE.get(getRawStorageKey(seededEmail.emailId))).toBeNull();
    expect(await env.STORAGE.get(seededEmail.attachments[0]?.storageKey ?? "missing")).toBeNull();
  });

  it("handles the zero-expired-inbox case cleanly", async () => {
    await seedDomain("mail.test", true);
    const inbox = await seedInbox({
      address: "reader@mail.test",
    });

    const result = await cleanupExpiredInboxes(env);
    const storedInbox = await getDb().query.inboxes.findFirst({
      where: (table, { eq }) => eq(table.id, inbox.id),
    });

    expect(result).toEqual({ deleted: 0 });
    expect(storedInbox?.fullAddress).toBe(inbox.fullAddress);
  });
});
