import type { Hono } from "hono";
import {
  CreateInboxRequest,
  CreateInboxResponse,
  ErrorResponse,
  ExtendInboxRequest,
  ExtendInboxResponse,
  InboxInfo,
  OkResponse,
  WebSocketTicketResponse,
} from "@/shared/contracts";
import { createLogger, errorContext } from "@/worker/logger";
import { getPublicErrorMessage } from "@/worker/security";
import { requireInboxAccess } from "@/worker/middleware/auth";
import {
  createTemporaryInbox,
  createWebSocketTicket,
  deleteInbox,
  extendTemporaryInbox,
  isAllowedTempMailboxTtl,
} from "@/worker/services/inbox";
import { verifyTurnstileToken } from "@/worker/services/turnstile";
import type { AppBindings } from "@/worker/types";

const logger = createLogger("inbox-api");

export function registerInboxRoutes(app: Hono<AppBindings>) {
  app.post("/api/inboxes", async (c) => {
    let body;

    try {
      body = CreateInboxRequest.assertDecode(await c.req.json());
    } catch {
      return c.json(ErrorResponse.create({ error: "A domain is required" }), 400);
    }

    const domain = body.domain.trim().toLowerCase();

    if (!domain) {
      return c.json(ErrorResponse.create({ error: "A domain is required" }), 400);
    }

    const turnstileResult = await verifyTurnstileToken(c.env, {
      token: body.turnstileToken,
      expectedAction: "create_inbox",
      remoteIp: c.req.header("cf-connecting-ip"),
      requestUrl: c.req.url,
    });

    if (!turnstileResult.ok) {
      logger.warn("create_inbox_turnstile_failed", "Rejected inbox creation request", {
        domain,
        ttlHours: body.ttlHours,
        reason: turnstileResult.reason,
        errorCodes: turnstileResult.errorCodes,
      });
      return c.json(ErrorResponse.create({ error: turnstileResult.message }), turnstileResult.status);
    }

    try {
      const inbox = await createTemporaryInbox(c.env, domain, body.ttlHours, c.get("db"));
      return c.json(
        CreateInboxResponse.create({
          address: inbox.address,
          token: inbox.token,
          ttlHours: inbox.ttlHours,
          expiresAt: inbox.expiresAt.toISOString(),
        }),
        201,
      );
    } catch (error) {
      logger.warn("create_inbox_failed", "Could not create inbox", {
        domain,
        ttlHours: body.ttlHours,
        ...errorContext(error),
      });
      return c.json(
        ErrorResponse.create({
          error: getPublicErrorMessage(error, "Could not create inbox"),
        }),
        400,
      );
    }
  });

  app.get("/api/inboxes/:address", requireInboxAccess, async (c) => {
    const inbox = c.get("inbox");
    const ttlHours = inbox.expiresAt
      ? Math.round((inbox.expiresAt.getTime() - inbox.createdAt.getTime()) / (60 * 60 * 1000))
      : null;
    return c.json(InboxInfo.create({
      address: inbox.fullAddress,
      isPermanent: inbox.isPermanent,
      ttlHours: ttlHours !== null && isAllowedTempMailboxTtl(ttlHours) ? ttlHours : null,
      expiresAt: inbox.expiresAt?.toISOString() ?? null,
      createdAt: inbox.createdAt.toISOString(),
    }));
  });

  app.post("/api/inboxes/:address/extend", requireInboxAccess, async (c) => {
    const inbox = c.get("inbox");
    const session = c.get("session");
    const token = c.get("token");

    if (session.type === "admin") {
      return c.json(ErrorResponse.create({ error: "Admin inspection for temporary inboxes is read-only" }), 403);
    }

    let body;

    try {
      body = ExtendInboxRequest.assertDecode(await c.req.json());
    } catch {
      return c.json(ErrorResponse.create({ error: "A valid mailbox duration is required" }), 400);
    }

    try {
      const result = await extendTemporaryInbox(c.env, inbox, token, session, body.ttlHours, c.get("db"));
      return c.json(ExtendInboxResponse.create({
        address: inbox.fullAddress,
        ttlHours: result.ttlHours,
        expiresAt: result.expiresAt.toISOString(),
      }));
    } catch (error) {
      logger.warn("extend_inbox_failed", "Could not extend inbox", {
        address: inbox.fullAddress,
        requestedTtlHours: body.ttlHours,
        ...errorContext(error),
      });
      return c.json(ErrorResponse.create({ error: getPublicErrorMessage(error, "Could not extend inbox") }), 400);
    }
  });

  app.post("/api/inboxes/:address/ws-ticket", requireInboxAccess, async (c) => {
    const inbox = c.get("inbox");
    const session = c.get("session");
    const ticket = await createWebSocketTicket(c.env, inbox.fullAddress, session);

    return c.json(WebSocketTicketResponse.create({ ticket }));
  });

  app.delete("/api/inboxes/:address", requireInboxAccess, async (c) => {
    const inbox = c.get("inbox");

    try {
      await deleteInbox(c.env, inbox, c.get("db"));
      return c.json(OkResponse.create({ ok: true }));
    } catch (error) {
      logger.warn("delete_inbox_failed", "Could not delete inbox", {
        address: inbox.fullAddress,
        ...errorContext(error),
      });
      return c.json(
        ErrorResponse.create({
          error: getPublicErrorMessage(error, "Could not delete inbox"),
        }),
        403,
      );
    }
  });
}
