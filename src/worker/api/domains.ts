import type { Hono } from "hono";
import { DomainsResponse } from "@/shared/contracts";
import { listActiveDomains } from "@/worker/services/inbox";
import type { AppBindings } from "@/worker/types";

export function registerDomainRoutes(app: Hono<AppBindings>) {
  app.get("/api/public/domains", async (c) => {
    const availableDomains = await listActiveDomains(c.env, c.get("db"));
    return c.json(
      DomainsResponse.create({
        domains: availableDomains.map((domain) => domain.domain),
      }),
    );
  });
}
