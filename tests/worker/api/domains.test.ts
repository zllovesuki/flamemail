import { beforeEach, describe, expect, it } from "vitest";
import { apiRequest, resetWorkerState, seedDomain } from "./helpers";

describe("worker api /api/public/domains", () => {
  beforeEach(async () => {
    await resetWorkerState();
  });

  it("returns only active domains", async () => {
    await seedDomain("mail.test", true);
    await seedDomain("inactive.test", false);
    await seedDomain("alpha.test", true);

    const response = await apiRequest("/api/public/domains");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      domains: ["alpha.test", "mail.test"],
    });
  });

  it("returns an empty list when there are no active domains", async () => {
    await seedDomain("inactive.test", false);

    const response = await apiRequest("/api/public/domains");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      domains: [],
    });
  });
});
