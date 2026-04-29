import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import type { AppContext } from "@/worker/types";

export const ADMIN_COOKIE_NAME = "__Host-flamemail-admin";
export const OIDC_TRANSACTION_COOKIE_NAME = "__Host-flamemail-oidc";

const OIDC_TRANSACTION_MAX_AGE_SECONDS = 5 * 60;

const SHARED_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
} as const satisfies CookieOptions;

export function setAdminCookie(c: AppContext, token: string, ttlSeconds: number) {
  setCookie(c, ADMIN_COOKIE_NAME, token, {
    ...SHARED_COOKIE_OPTIONS,
    maxAge: Math.max(60, Math.floor(ttlSeconds)),
  });
}

export function getAdminCookie(c: AppContext): string | undefined {
  return getCookie(c, ADMIN_COOKIE_NAME);
}

export function clearAdminCookie(c: AppContext) {
  deleteCookie(c, ADMIN_COOKIE_NAME, SHARED_COOKIE_OPTIONS);
}

export function setOidcTransactionCookie(c: AppContext, sealed: string) {
  setCookie(c, OIDC_TRANSACTION_COOKIE_NAME, sealed, {
    ...SHARED_COOKIE_OPTIONS,
    maxAge: OIDC_TRANSACTION_MAX_AGE_SECONDS,
  });
}

export function getOidcTransactionCookie(c: AppContext): string | undefined {
  return getCookie(c, OIDC_TRANSACTION_COOKIE_NAME);
}

export function clearOidcTransactionCookie(c: AppContext) {
  deleteCookie(c, OIDC_TRANSACTION_COOKIE_NAME, SHARED_COOKIE_OPTIONS);
}
