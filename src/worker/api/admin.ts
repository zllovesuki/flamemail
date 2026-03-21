import { asc, count, eq, inArray } from "drizzle-orm";
import type { Hono } from "hono";
import {
  ADMIN_ACCESS_DISABLED_ERROR_CODE,
  AdminDomainRequest,
  AdminDomainStatusRequest,
  AdminInboxesResponse,
  AdminLoginRequest,
  AdminTempInboxPage,
  ErrorResponse,
  OkResponse,
  TokenResponse,
} from "@/shared/contracts";
import { emails, inboxes } from "@/worker/db/schema";
import { createLogger, errorContext } from "@/worker/logger";
import { requireAdmin } from "@/worker/middleware/auth";
import { createAdminDomainsResponse } from "@/worker/serializers/admin";
import {
  ADMIN_ACCESS_UNAVAILABLE_MESSAGE,
  constantTimeEqualStrings,
  getAdminPasswordConfigurationIssue,
  getPublicErrorMessage,
} from "@/worker/security";
import {
  ADMIN_SESSION_TTL_MS,
  addDomain,
  createSessionToken,
  deleteDomainByName,
  listActiveTemporaryInboxesForAdmin,
  listDomainsForAdmin,
  updateDomainStatus,
} from "@/worker/services/inbox";
import { verifyTurnstileToken } from "@/worker/services/turnstile";
import type { AppBindings } from "@/worker/types";

const logger = createLogger("admin-api");

export function registerAdminRoutes(app: Hono<AppBindings>) {
  app.post("/api/public/admin/login", async (c) => {
    const configIssue = getAdminPasswordConfigurationIssue(c.env.ADMIN_PASSWORD);
    if (configIssue) {
      logger.warn("admin_login_disabled", "Blocked admin login because ADMIN_PASSWORD is not configured securely", {
        reason: configIssue,
      });
      return c.json(
        ErrorResponse.create({
          code: ADMIN_ACCESS_DISABLED_ERROR_CODE,
          error: ADMIN_ACCESS_UNAVAILABLE_MESSAGE,
        }),
        503,
      );
    }

    let body;

    try {
      body = AdminLoginRequest.assertDecode(await c.req.json());
    } catch {
      return c.json(ErrorResponse.create({ error: "Invalid login request" }), 400);
    }

    const turnstileResult = await verifyTurnstileToken(c.env, {
      token: body.turnstileToken,
      expectedAction: "admin_login",
      remoteIp: c.req.header("cf-connecting-ip"),
      requestUrl: c.req.url,
    });

    if (!turnstileResult.ok) {
      logger.warn("admin_login_turnstile_failed", "Rejected admin login attempt", {
        reason: turnstileResult.reason,
        errorCodes: turnstileResult.errorCodes,
      });
      return c.json(ErrorResponse.create({ error: turnstileResult.message }), turnstileResult.status);
    }

    const password = body.password;

    const passwordMatches = constantTimeEqualStrings(password, c.env.ADMIN_PASSWORD);

    if (!passwordMatches) {
      logger.warn("admin_login_failed", "Rejected admin login attempt", {
        reason: "invalid_password",
      });
      return c.json(ErrorResponse.create({ error: "Invalid admin password" }), 401);
    }

    const token = await createSessionToken(
      c.env,
      {
        type: "admin",
      },
      ADMIN_SESSION_TTL_MS,
    );

    logger.info("admin_login_succeeded", "Created admin session token");

    return c.json(TokenResponse.create({ token }));
  });

  app.get("/api/protected/admin/domains", requireAdmin, async (c) => {
    const db = c.get("db");
    const items = await listDomainsForAdmin(c.env, db);
    return c.json(createAdminDomainsResponse(items));
  });

  app.get("/api/protected/admin/temp-inboxes", requireAdmin, async (c) => {
    const page = Number.parseInt(c.req.query("page") ?? "0", 10);
    const hasEmails = c.req.query("hasEmails") === "true";
    const results = await listActiveTemporaryInboxesForAdmin(c.env, page, undefined, c.get("db"), hasEmails);

    return c.json(
      AdminTempInboxPage.create({
        page: results.page,
        pageSize: results.pageSize,
        total: results.total,
        inboxes: results.items.map((item) => ({
          address: item.address,
          domain: item.domain,
          createdAt: item.createdAt.toISOString(),
          expiresAt: item.expiresAt?.toISOString() ?? null,
          ttlHours: item.ttlHours,
          emailCount: item.emailCount,
        })),
      }),
    );
  });

  app.post("/api/protected/admin/domains", requireAdmin, async (c) => {
    let body;

    try {
      body = AdminDomainRequest.assertDecode(await c.req.json());
    } catch {
      return c.json(ErrorResponse.create({ error: "A valid domain is required" }), 400);
    }

    try {
      const db = c.get("db");
      await addDomain(c.env, body.domain, body.isActive ?? true, db);
      const items = await listDomainsForAdmin(c.env, db);
      return c.json(createAdminDomainsResponse(items), 201);
    } catch (error) {
      logger.warn("domain_add_failed", "Could not add domain", {
        domain: body.domain,
        ...errorContext(error),
      });
      return c.json(ErrorResponse.create({ error: getPublicErrorMessage(error, "Could not add domain") }), 400);
    }
  });

  app.patch("/api/protected/admin/domains/:domain", requireAdmin, async (c) => {
    let body;

    try {
      body = AdminDomainStatusRequest.assertDecode(await c.req.json());
    } catch {
      return c.json(ErrorResponse.create({ error: "A valid active status is required" }), 400);
    }

    const domainName = decodeURIComponent(c.req.param("domain"));

    try {
      await updateDomainStatus(c.env, domainName, body.isActive, c.get("db"));
      return c.json(OkResponse.create({ ok: true }));
    } catch (error) {
      logger.warn("domain_status_update_failed", "Could not update domain status", {
        domain: domainName,
        isActive: body.isActive,
        ...errorContext(error),
      });
      return c.json(ErrorResponse.create({ error: getPublicErrorMessage(error, "Could not update domain") }), 400);
    }
  });

  app.delete("/api/protected/admin/domains/:domain", requireAdmin, async (c) => {
    const domainName = decodeURIComponent(c.req.param("domain"));

    try {
      await deleteDomainByName(c.env, domainName, c.get("db"));
      return c.json(OkResponse.create({ ok: true }));
    } catch (error) {
      const message = getPublicErrorMessage(error, "Could not delete domain");
      logger.warn("domain_delete_failed", "Could not delete domain", {
        domain: domainName,
        ...errorContext(error),
      });
      const status = message.includes("still has inboxes") ? 409 : 400;
      return c.json(ErrorResponse.create({ error: message }), status);
    }
  });

  app.get("/api/protected/admin/inboxes", requireAdmin, async (c) => {
    const db = c.get("db");

    try {
      const items = await db.query.inboxes.findMany({
        where: eq(inboxes.isPermanent, true),
        orderBy: [asc(inboxes.domain), asc(inboxes.localPart)],
      });

      const emailCounts = items.length
        ? await db
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

      return c.json(
        AdminInboxesResponse.create({
          inboxes: items.map((item) => ({
            address: item.fullAddress,
            domain: item.domain,
            localPart: item.localPart,
            emailCount: emailCountByInboxId.get(item.id) ?? 0,
          })),
        }),
      );
    } catch (error) {
      logger.error("admin_inbox_list_failed", "Could not list permanent inboxes", errorContext(error));
      return c.json(ErrorResponse.create({ error: "Could not list permanent inboxes" }), 500);
    }
  });
}
