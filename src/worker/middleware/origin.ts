import { createMiddleware } from "hono/factory";
import { ErrorResponse } from "@/shared/contracts";
import type { AppBindings, AppContext } from "@/worker/types";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function jsonError(message: string, status: number) {
  return new Response(
    JSON.stringify(
      ErrorResponse.create({
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

// Returns a 403 Response if the request is a non-safe method without an
// Origin header matching the request origin; null otherwise. SameSite=Lax
// already keeps cookies off most cross-site mutations; the explicit check
// covers same-site sibling subdomains and any future cookie-attribute
// drift.
export function sameOriginViolation(c: AppContext): Response | null {
  if (SAFE_METHODS.has(c.req.method)) {
    return null;
  }

  const origin = c.req.header("origin");
  if (!origin) {
    return jsonError("Forbidden", 403);
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return jsonError("Forbidden", 403);
  }

  if (originUrl.origin !== new URL(c.req.url).origin) {
    return jsonError("Forbidden", 403);
  }

  return null;
}

export const requireSameOriginForCookieMutations = createMiddleware<AppBindings>(async (c, next) => {
  const violation = sameOriginViolation(c);
  if (violation) {
    return violation;
  }
  await next();
});
