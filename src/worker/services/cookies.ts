import { deleteCookie, getCookie, getSignedCookie, setCookie, setSignedCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import type { AppContext } from "@/worker/types";

export const AUTH_COOKIE_PREFIX = "host";
export const ADMIN_COOKIE_NAME = "flamemail-admin";
export const OIDC_TRANSACTION_COOKIE_NAME = "flamemail-oidc";
export const ADMIN_COOKIE_HEADER_NAME = `__Host-${ADMIN_COOKIE_NAME}`;
export const OIDC_TRANSACTION_COOKIE_HEADER_NAME = `__Host-${OIDC_TRANSACTION_COOKIE_NAME}`;

const OIDC_TRANSACTION_MAX_AGE_SECONDS = 5 * 60;

const SHARED_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "Lax",
  prefix: AUTH_COOKIE_PREFIX,
} as const satisfies CookieOptions;

export type SignedCookieReadResult =
  | { kind: "ok"; value: string }
  | { kind: "missing" }
  | { kind: "invalid_signature" };
export type CookieSigningSecret = BufferSource;

export function setAdminCookie(c: AppContext, token: string, ttlSeconds: number) {
  setCookie(c, ADMIN_COOKIE_NAME, token, {
    ...SHARED_COOKIE_OPTIONS,
    maxAge: Math.max(60, Math.floor(ttlSeconds)),
  });
}

export function getAdminCookie(c: AppContext): string | undefined {
  return getCookie(c, ADMIN_COOKIE_NAME, AUTH_COOKIE_PREFIX);
}

export function clearAdminCookie(c: AppContext) {
  deleteCookie(c, ADMIN_COOKIE_NAME, SHARED_COOKIE_OPTIONS);
}

export async function setOidcTransactionCookie(
  c: AppContext,
  value: string,
  secret: CookieSigningSecret,
): Promise<void> {
  await setSignedCookie(c, OIDC_TRANSACTION_COOKIE_NAME, value, secret, {
    ...SHARED_COOKIE_OPTIONS,
    maxAge: OIDC_TRANSACTION_MAX_AGE_SECONDS,
  });
}

export async function getOidcTransactionCookie(
  c: AppContext,
  secret: CookieSigningSecret,
): Promise<SignedCookieReadResult> {
  const rawValue = getCookie(c, OIDC_TRANSACTION_COOKIE_NAME, AUTH_COOKIE_PREFIX);
  if (rawValue === undefined) {
    return { kind: "missing" };
  }

  const value = await getSignedCookie(c, secret, OIDC_TRANSACTION_COOKIE_NAME, AUTH_COOKIE_PREFIX);
  if (value === undefined || value === false) {
    return { kind: "invalid_signature" };
  }

  return { kind: "ok", value };
}

export function clearOidcTransactionCookie(c: AppContext) {
  deleteCookie(c, OIDC_TRANSACTION_COOKIE_NAME, SHARED_COOKIE_OPTIONS);
}
