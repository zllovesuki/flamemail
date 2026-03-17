import type { Hono } from "hono";
import { ErrorResponse, PublicConfigResponse } from "@/shared/contracts";
import type { AppBindings } from "@/worker/types";

export function registerConfigRoutes(app: Hono<AppBindings>) {
  app.get("/api/public/config", async (c) => {
    const siteKey = c.env.TURNSTILE_SITE_KEY?.trim();

    if (!siteKey) {
      return c.json(
        ErrorResponse.create({
          error: "Human verification is temporarily unavailable.",
        }),
        503,
      );
    }

    return c.json(
      PublicConfigResponse.create({
        turnstileSiteKey: siteKey,
      }),
    );
  });
}
