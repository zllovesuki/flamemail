import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { ADMIN_ACCESS_DISABLED_ERROR_CODE, ErrorResponse } from "@/shared/contracts";
import { inboxes } from "@/worker/db/schema";
import { ADMIN_ACCESS_UNAVAILABLE_MESSAGE, decodeSessionRecord } from "@/worker/security";
import { getAdminCookie } from "@/worker/services/cookies";
import { sameOriginViolation } from "@/worker/middleware/origin";
import { loadOidcConfig } from "@/worker/services/oidc";
import { createLogger } from "@/worker/logger";
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
  logger.warn("admin_access_disabled", "Blocked admin request because tessera OIDC is not configured", {
    method: c.req.method,
    path: c.req.path,
    reason,
  });
  return jsonError(ADMIN_ACCESS_UNAVAILABLE_MESSAGE, 503, ADMIN_ACCESS_DISABLED_ERROR_CODE);
}

async function readKvSession(env: Env, token: string | null | undefined) {
  if (!token) {
    return null;
  }
  const raw = await env.SESSIONS.get(`token:${token}`);
  if (!raw) {
    return null;
  }
  return decodeSessionRecord(raw);
}

export async function readUserBearerSession(c: AppContext) {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return null;
  }
  const session = await readKvSession(c.env, token);
  if (!session || session.type !== "user") {
    return null;
  }
  return { session, token };
}

export async function readAdminCookieSession(c: AppContext) {
  const token = getAdminCookie(c);
  if (!token) {
    return null;
  }
  const session = await readKvSession(c.env, token);
  if (!session || session.type !== "admin") {
    return null;
  }
  return { session, token };
}

async function loadInboxForAddress(c: AppContext): Promise<Response | null> {
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

  if (!inbox.isPermanent && inbox.expiresAt && inbox.expiresAt.getTime() < Date.now()) {
    return jsonError("Inbox has expired", 410);
  }

  c.set("inbox", inbox);
  return null;
}

async function authorizeAdminOrFail(c: AppContext): Promise<Response | null> {
  const config = loadOidcConfig(c.env);
  if (!config.ok) {
    return adminAccessUnavailable(c, config.reason);
  }
  const auth = await readAdminCookieSession(c);
  if (!auth) {
    return jsonError("Unauthorized", 401);
  }
  // Re-check the allowlist on every request so demoting an operator in
  // TESSERA_OPERATOR_SUBS revokes their existing session immediately
  // instead of waiting for the KV TTL to roll off.
  if (!config.config.operatorSubs.includes(auth.session.sub)) {
    return jsonError("Forbidden", 403);
  }
  c.set("session", auth.session);
  return null;
}

// Admin API class: cookie-only, OIDC config + allowlist re-checked.
export const requireAdmin = createMiddleware<AppBindings>(async (c, next) => {
  const failure = await authorizeAdminOrFail(c);
  if (failure) {
    return failure;
  }
  await next();
});

// User class on /inbox routes (no `?admin=1`): bearer-only matching the
// requested address. Stale bearer-admin tokens fail the type === "user"
// check inside readUserBearerSession.
export const requireInboxAccess = createMiddleware<AppBindings>(async (c, next) => {
  const auth = await readUserBearerSession(c);
  if (!auth) {
    return jsonError("Unauthorized", 401);
  }

  const addressParam = c.req.param("address");
  if (!addressParam) {
    return jsonError("Inbox address is required", 400);
  }
  const address = decodeURIComponent(addressParam);
  if (auth.session.address !== address) {
    return jsonError("Forbidden", 403);
  }

  c.set("session", auth.session);
  c.set("token", auth.token);

  const errorResponse = await loadInboxForAddress(c);
  if (errorResponse) {
    return errorResponse;
  }

  await next();
});

// Admin-inspect class: cookie-only admin session (OIDC config +
// allowlist re-checked) reading any inbox.
// Same 404/410 semantics as requireInboxAccess via the shared loader.
export const requireAdminInspect = createMiddleware<AppBindings>(async (c, next) => {
  const failure = await authorizeAdminOrFail(c);
  if (failure) {
    return failure;
  }

  const errorResponse = await loadInboxForAddress(c);
  if (errorResponse) {
    return errorResponse;
  }

  await next();
});

// Selector for inbox/email routes. `?admin=1` selects the cookie-only
// admin-inspect chain (with same-origin enforced for non-safe methods);
// otherwise the bearer-only user chain runs. The chosen credential
// middleware runs once per request.
export const requireInboxRouteAccess = createMiddleware<AppBindings>(async (c, next) => {
  const isAdminInspect = c.req.query("admin") === "1";
  if (!isAdminInspect) {
    return requireInboxAccess(c, next);
  }

  const violation = sameOriginViolation(c);
  if (violation) {
    return violation;
  }

  return requireAdminInspect(c, next);
});
