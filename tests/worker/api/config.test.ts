import { beforeEach, describe, expect, it } from "vitest";
import { apiRequest, resetWorkerState } from "./helpers";

describe("worker api /api/public/config", () => {
  beforeEach(async () => {
    await resetWorkerState();
  });

  it("returns the turnstile site key when configured", async () => {
    const response = await apiRequest("/api/public/config");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      turnstileSiteKey: "1x00000000000000000000AA",
    });
  });

  it("returns 503 when the turnstile site key is missing", async () => {
    const response = await apiRequest("/api/public/config", {
      envOverrides: {
        TURNSTILE_SITE_KEY: "",
      },
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Human verification is temporarily unavailable.",
    });
  });
});
