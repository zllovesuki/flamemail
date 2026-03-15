import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { ADMIN_ACCESS_DISABLED_ERROR_CODE, ErrorResponse } from "@/shared/contracts";
import { inboxes } from "@/worker/db/schema";
import { createLogger } from "@/worker/logger";
import {
  ADMIN_ACCESS_UNAVAILABLE_MESSAGE,
  decodeSessionRecord,
  getAdminPasswordConfigurationIssue,
} from "@/worker/security";
import type { AppBindings, AppContext } from "@/worker/types";

const logger = createLogger("auth");

function jsonError(message: string, status: number, code?: typeof ADMIN_ACCESS_DISABLED_ERROR_CODE) {
  return new Response(
    JSON.stringify(
      ErrorResponse.create({
        ...(code ? { code } : {}),
        error: message,
      }),
    ),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    },
  );
}

function adminAccessUnavailable(c: AppContext, reason: string) {
  logger.warn("admin_access_disabled", "Blocked admin request because ADMIN_PASSWORD is not configured securely", {
    method: c.req.method,
    path: c.req.path,
    reason,
  });

  return jsonError(ADMIN_ACCESS_UNAVAILABLE_MESSAGE, 503, ADMIN_ACCESS_DISABLED_ERROR_CODE);
}

export async function readSession(env: Env, token: string | null | undefined) {
  if (!token) {
    return null;
  }

  const raw = await env.SESSIONS.get(`token:${token}`);
  if (!raw) {
    return null;
  }

  return decodeSessionRecord(raw);
}

async function loadSession(c: AppContext) {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const session = await readSession(c.env, token);

  if (!session) {
    return null;
  }

  c.set("session", session);
  c.set("token", token);
  return session;
}

export const requireAdmin = createMiddleware<AppBindings>(async (c, next) => {
  const configIssue = getAdminPasswordConfigurationIssue(c.env.ADMIN_PASSWORD);
  if (configIssue) {
    return adminAccessUnavailable(c, configIssue);
  }

  const session = await loadSession(c);
  if (!session) {
    return jsonError("Unauthorized", 401);
  }

  if (session.type !== "admin") {
    return jsonError("Forbidden", 403);
  }

  await next();
});

export const requireInboxAccess = createMiddleware<AppBindings>(async (c, next) => {
  const session = await loadSession(c);
  if (!session) {
    return jsonError("Unauthorized", 401);
  }

  const addressParam = c.req.param("address");
  if (!addressParam) {
    return jsonError("Inbox address is required", 400);
  }

  const address = decodeURIComponent(addressParam);
  const db = c.get("db");
  const inbox = await db.query.inboxes.findFirst({
    where: eq(inboxes.fullAddress, address),
  });

  if (!inbox) {
    return jsonError("Inbox not found", 404);
  }

  if (session.type === "user" && session.address !== address) {
    return jsonError("Forbidden", 403);
  }

  if (!inbox.isPermanent && inbox.expiresAt && inbox.expiresAt.getTime() < Date.now()) {
    return jsonError("Inbox has expired", 410);
  }

  c.set("inbox", inbox);
  await next();
});
