import type { Hono } from "hono";
import { ADMIN_ACCESS_DISABLED_ERROR_CODE, OkResponse } from "@/shared/contracts";
import { readAdminCookieSession } from "@/worker/middleware/auth";
import { requireSameOriginForCookieMutations } from "@/worker/middleware/origin";
import { createLogger, errorContext } from "@/worker/logger";
import { ADMIN_ACCESS_UNAVAILABLE_MESSAGE } from "@/worker/security";
import {
  clearAdminCookie,
  clearOidcTransactionCookie,
  getOidcTransactionCookie,
  setAdminCookie,
  setOidcTransactionCookie,
} from "@/worker/services/cookies";
import {
  buildAuthorizeUrl,
  buildCallbackUrl,
  discoverOidcProvider,
  exchangeAuthorizationCode,
  generateNonce,
  generatePkcePair,
  generateState,
  loadOidcConfig,
  sealTransaction,
  unsealTransaction,
  verifyIdTokenClaims,
} from "@/worker/services/oidc";
import { ADMIN_SESSION_TTL_MS, createSessionToken, revokeAdminSessionToken } from "@/worker/services/inbox";
import type { AppBindings, AppContext } from "@/worker/types";

const logger = createLogger("admin-oidc");

function adminUnavailableRedirect(c: AppContext) {
  // The admin sign-in card surfaces the unavailable banner via this code.
  // Mirrors the pre-OIDC ADMIN_ACCESS_DISABLED contract so the React route
  // does not need a new error path.
  return c.redirect(`/admin?error=${encodeURIComponent(ADMIN_ACCESS_DISABLED_ERROR_CODE)}`);
}

function callbackErrorRedirect(c: AppContext, code: string) {
  clearOidcTransactionCookie(c);
  return c.redirect(`/admin?error=${encodeURIComponent(code)}`);
}

export function registerAdminOidcRoutes(app: Hono<AppBindings>) {
  app.get("/api/public/admin/start", async (c) => {
    const result = loadOidcConfig(c.env);
    if (!result.ok) {
      logger.warn("oidc_start_disabled", "OIDC start blocked because tessera config is incomplete", {
        reason: result.reason,
      });
      return adminUnavailableRedirect(c);
    }

    const config = result.config;
    const providerResult = await discoverOidcProvider(config);
    if (!providerResult.ok) {
      logger.warn("oidc_start_discovery_failed", "OIDC start blocked because tessera discovery failed", {
        reason: providerResult.reason,
      });
      return adminUnavailableRedirect(c);
    }

    const state = generateState();
    const nonce = generateNonce();
    const pkce = await generatePkcePair();
    const redirectUri = buildCallbackUrl(c.req.url);

    let sealed: string;
    try {
      sealed = await sealTransaction(config.clientSecret, {
        state,
        nonce,
        codeVerifier: pkce.verifier,
        redirectUri,
        createdAt: Date.now(),
      });
    } catch (error) {
      logger.error("oidc_start_seal_failed", "Could not seal OIDC transaction cookie", errorContext(error));
      return adminUnavailableRedirect(c);
    }

    setOidcTransactionCookie(c, sealed);

    const authorizeUrl = buildAuthorizeUrl(providerResult.provider, {
      redirectUri,
      state,
      nonce,
      codeChallenge: pkce.challenge,
    });

    return c.redirect(authorizeUrl);
  });

  app.get("/api/public/admin/callback", async (c) => {
    const result = loadOidcConfig(c.env);
    if (!result.ok) {
      logger.warn("oidc_callback_disabled", "OIDC callback blocked because tessera config is incomplete", {
        reason: result.reason,
      });
      return adminUnavailableRedirect(c);
    }

    const config = result.config;
    const code = c.req.query("code") ?? "";
    const state = c.req.query("state") ?? "";
    if (!code || !state) {
      logger.warn("oidc_callback_missing_params", "Rejected callback with missing code/state");
      return callbackErrorRedirect(c, "invalid_request");
    }

    const sealed = getOidcTransactionCookie(c);
    if (!sealed) {
      logger.warn("oidc_callback_missing_cookie", "Rejected callback with missing transaction cookie");
      return callbackErrorRedirect(c, "missing_state");
    }

    const unsealed = await unsealTransaction(config.clientSecret, sealed);
    if (!unsealed.ok) {
      logger.warn("oidc_callback_unseal_failed", "Rejected callback with bad transaction cookie", {
        reason: unsealed.reason,
      });
      return callbackErrorRedirect(c, "invalid_state");
    }

    if (unsealed.payload.state !== state) {
      logger.warn("oidc_callback_state_mismatch", "Rejected callback with mismatched state");
      return callbackErrorRedirect(c, "invalid_state");
    }

    if (unsealed.payload.redirectUri !== buildCallbackUrl(c.req.url)) {
      logger.warn("oidc_callback_redirect_uri_mismatch", "Rejected callback with mismatched redirect_uri");
      return callbackErrorRedirect(c, "invalid_state");
    }

    const providerResult = await discoverOidcProvider(config);
    if (!providerResult.ok) {
      logger.warn("oidc_callback_discovery_failed", "OIDC callback blocked because tessera discovery failed", {
        reason: providerResult.reason,
      });
      clearOidcTransactionCookie(c);
      return adminUnavailableRedirect(c);
    }

    const tokenResult = await exchangeAuthorizationCode(providerResult.provider, {
      callbackUrl: c.req.url,
      codeVerifier: unsealed.payload.codeVerifier,
      nonce: unsealed.payload.nonce,
      state,
    });
    if (!tokenResult.ok) {
      logger.warn("oidc_callback_token_exchange_failed", "Token exchange with tessera failed", {
        reason: tokenResult.reason,
      });
      const errorCode = tokenResult.reason === "invalid_id_token" ? "invalid_id_token" : "token_exchange_failed";
      return callbackErrorRedirect(c, errorCode);
    }

    const verified = verifyIdTokenClaims(config, tokenResult.tokens.claims);
    if (!verified.ok) {
      logger.warn("oidc_callback_verify_failed", "ID token verification failed", {
        reason: verified.reason,
      });
      const errorCode = verified.reason === "sub_not_allowed" ? "not_operator" : "invalid_id_token";
      return callbackErrorRedirect(c, errorCode);
    }

    let token: string;
    try {
      token = await createSessionToken(c.env, { type: "admin", sub: verified.verified.sub }, ADMIN_SESSION_TTL_MS);
    } catch (error) {
      logger.error("oidc_callback_session_create_failed", "Could not create admin session", errorContext(error));
      return callbackErrorRedirect(c, "session_create_failed");
    }

    setAdminCookie(c, token, Math.floor(ADMIN_SESSION_TTL_MS / 1000));
    clearOidcTransactionCookie(c);

    logger.info("admin_login_succeeded", "Created admin session via tessera OIDC");
    return c.redirect("/admin");
  });

  app.post("/api/public/admin/logout", requireSameOriginForCookieMutations, async (c) => {
    const auth = await readAdminCookieSession(c);
    if (auth) {
      try {
        await revokeAdminSessionToken(c.env, auth.token);
      } catch (error) {
        logger.warn("admin_logout_revoke_failed", "Could not revoke admin session token", errorContext(error));
      }
    }
    clearAdminCookie(c);
    return c.json(OkResponse.create({ ok: true }));
  });
}

export { ADMIN_ACCESS_UNAVAILABLE_MESSAGE };
