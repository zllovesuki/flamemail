import { handleIncomingEmail } from "@/worker/email-handler";
import { InboxWebSocket } from "@/worker/durable-objects/inbox-ws";
import { createDb } from "@/worker/db";
import { createLogger } from "@/worker/logger";
import { app } from "@/worker/router";
import { isAllowedWebSocketOrigin, withSecurityHeaders } from "@/worker/security";
import { cleanupExpiredInboxes, consumeWebSocketTicket, getInboxByAddress } from "@/worker/services/inbox";

export { InboxWebSocket };
const logger = createLogger("worker");

async function handleWebSocketUpgrade(request: Request, env: Env) {
  const url = new URL(request.url);
  const address = url.searchParams.get("address")?.trim().toLowerCase() ?? "";
  const ticket = url.searchParams.get("ticket");

  if (!address || request.headers.get("upgrade") !== "websocket") {
    logger.warn("websocket_upgrade_rejected", "Rejected websocket upgrade request", {
      address,
      reason: "missing_upgrade_or_address",
    });
    return new Response("Expected websocket upgrade", { status: 426 });
  }

  if (!isAllowedWebSocketOrigin(request)) {
    logger.warn("websocket_upgrade_rejected", "Rejected websocket upgrade request", {
      address,
      reason: "invalid_origin",
    });
    return new Response("Forbidden", { status: 403 });
  }

  const ticketRecord = await consumeWebSocketTicket(env, ticket);
  if (!ticketRecord || ticketRecord.address !== address) {
    logger.warn("websocket_upgrade_rejected", "Rejected websocket upgrade request", {
      address,
      reason: "invalid_ticket",
    });
    return new Response("Unauthorized", { status: 401 });
  }

  const session = ticketRecord.session;

  const inbox = await getInboxByAddress(env, address, createDb(env.DB.withSession("first-primary")));
  if (!inbox) {
    logger.warn("websocket_upgrade_rejected", "Rejected websocket upgrade request", {
      address,
      reason: "inbox_not_found",
    });
    return new Response("Inbox not found", { status: 404 });
  }

  if (session.type === "user" && session.address !== address) {
    logger.warn("websocket_upgrade_rejected", "Rejected websocket upgrade request", {
      address,
      reason: "forbidden_user_scope",
    });
    return new Response("Forbidden", { status: 403 });
  }

  const stub = env.INBOX_WS.getByName(address);
  return stub.fetch(request);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return handleWebSocketUpgrade(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      const response = await app.fetch(request, env, ctx);
      return withSecurityHeaders(request, response);
    }

    const response = await env.ASSETS.fetch(request);
    return withSecurityHeaders(request, response);
  },

  async email(message, env, ctx) {
    await handleIncomingEmail(message, env, ctx);
  },

  async scheduled(_controller, env) {
    const result = await cleanupExpiredInboxes(env);
    logger.info("scheduled_cleanup_completed", "Finished scheduled inbox cleanup", {
      deleted: result.deleted,
    });
  },
} satisfies ExportedHandler<Env>;
