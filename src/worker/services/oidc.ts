import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";
import * as oidc from "openid-client";
import { isLoopbackHostname } from "@/worker/security";

const STATE_PURPOSE = "flamemail-admin-oidc-state-v1";
const STATE_TTL_MS = 5 * 60 * 1000;
const AES_GCM_IV_LENGTH = 12;
const AES_KEY_BIT_LENGTH = 256;
const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;

export const TransactionPayload = eg.object({
  state: eg.string,
  nonce: eg.string,
  codeVerifier: eg.string,
  redirectUri: eg.string,
  createdAt: eg.number,
});
export type TransactionPayload = TypeFromCodec<typeof TransactionPayload>;

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  operatorSubs: readonly string[];
}

export type OidcConfigError =
  | "missing_issuer"
  | "insecure_issuer"
  | "missing_client_id"
  | "missing_client_secret"
  | "missing_operator_subs";

export type OidcConfigResult = { ok: true; config: OidcConfig } | { ok: false; reason: OidcConfigError };

function isAllowedUrl(url: URL): boolean {
  if (url.protocol === "https:") {
    return true;
  }
  return url.protocol === "http:" && isLoopbackHostname(url.hostname);
}

function normalizeIssuer(rawIssuer: string): string | null {
  let url: URL;
  try {
    url = new URL(rawIssuer);
  } catch {
    return null;
  }
  if (url.search || url.hash || url.username || url.password) {
    return null;
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${pathname}`;
}

export function loadOidcConfig(env: Env): OidcConfigResult {
  const rawIssuer = env.TESSERA_OIDC_ISSUER?.trim();
  if (!rawIssuer) {
    return { ok: false, reason: "missing_issuer" };
  }
  const issuer = normalizeIssuer(rawIssuer);
  if (!issuer) {
    return { ok: false, reason: "insecure_issuer" };
  }
  const issuerUrl = new URL(issuer);
  // Plaintext HTTP only allowed for loopback (local dev / e2e fake provider).
  // Production deployments must use https; otherwise the client secret
  // would be POSTed to a plaintext token endpoint and ID tokens would be
  // verified against a plaintext JWKS.
  if (!isAllowedUrl(issuerUrl)) {
    return { ok: false, reason: "insecure_issuer" };
  }
  const clientId = env.TESSERA_OIDC_CLIENT_ID?.trim();
  if (!clientId) {
    return { ok: false, reason: "missing_client_id" };
  }
  const clientSecret = env.TESSERA_OIDC_CLIENT_SECRET?.trim();
  if (!clientSecret) {
    return { ok: false, reason: "missing_client_secret" };
  }
  const operatorSubs = parseOperatorSubs(env.TESSERA_OPERATOR_SUBS);
  if (operatorSubs.length === 0) {
    return { ok: false, reason: "missing_operator_subs" };
  }
  return { ok: true, config: { issuer, clientId, clientSecret, operatorSubs } };
}

export function parseOperatorSubs(raw: string | undefined | null): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 1) {
    binary += String.fromCharCode(view[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> {
  const padded = input
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(input.length + ((4 - (input.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export async function generatePkcePair(): Promise<PkcePair> {
  const verifier = oidc.randomPKCECodeVerifier();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier);
  return { verifier, challenge };
}

async function deriveSealKey(clientSecret: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", textEncoder.encode(clientSecret), { name: "HKDF" }, false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: textEncoder.encode(STATE_PURPOSE),
    },
    baseKey,
    { name: "AES-GCM", length: AES_KEY_BIT_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealTransaction(clientSecret: string, payload: TransactionPayload): Promise<string> {
  const key = await deriveSealKey(clientSecret);
  const iv = randomBytes(AES_GCM_IV_LENGTH);
  const plaintext = textEncoder.encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const sealed = new Uint8Array(iv.length + ciphertext.byteLength);
  sealed.set(iv, 0);
  sealed.set(new Uint8Array(ciphertext), iv.length);
  return base64UrlEncode(sealed);
}

export type UnsealError = "malformed" | "decrypt_failed" | "invalid_payload" | "expired";

export type UnsealResult = { ok: true; payload: TransactionPayload } | { ok: false; reason: UnsealError };

export async function unsealTransaction(
  clientSecret: string,
  encoded: string,
  now: number = Date.now(),
): Promise<UnsealResult> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = base64UrlDecode(encoded);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (raw.length <= AES_GCM_IV_LENGTH) {
    return { ok: false, reason: "malformed" };
  }
  const iv = raw.subarray(0, AES_GCM_IV_LENGTH);
  const ciphertext = raw.subarray(AES_GCM_IV_LENGTH);
  let plaintextBuffer: ArrayBuffer;
  try {
    const key = await deriveSealKey(clientSecret);
    plaintextBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  } catch {
    return { ok: false, reason: "decrypt_failed" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(plaintextBuffer));
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }
  let payload: TransactionPayload;
  try {
    payload = TransactionPayload.assertDecode(parsed);
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }
  if (now - payload.createdAt > STATE_TTL_MS) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}

export interface OidcProvider {
  configuration: oidc.Configuration;
}

export type OidcDiscoveryError = "discovery_failed" | "invalid_endpoint";

export type OidcDiscoveryResult = { ok: true; provider: OidcProvider } | { ok: false; reason: OidcDiscoveryError };

interface CachedOidcProvider {
  provider: OidcProvider;
  clientSecret: string;
  expiresAt: number;
}

const oidcProviderByIssuerAndClient = new Map<string, CachedOidcProvider>();

function isAllowedDiscoveredEndpoint(rawUrl: string | undefined): boolean {
  if (!rawUrl) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.hash) {
    return false;
  }
  return isAllowedUrl(url);
}

function cacheKey(config: OidcConfig): string {
  return `${config.issuer}\0${config.clientId}`;
}

function discoveryOptions(config: OidcConfig): oidc.DiscoveryRequestOptions | undefined {
  const issuerUrl = new URL(config.issuer);
  if (issuerUrl.protocol !== "http:") {
    return undefined;
  }
  return { execute: [oidc.allowInsecureRequests] };
}

function hasRequiredSecureEndpoints(configuration: oidc.Configuration): boolean {
  const metadata = configuration.serverMetadata();
  return (
    isAllowedDiscoveredEndpoint(metadata.authorization_endpoint) &&
    isAllowedDiscoveredEndpoint(metadata.token_endpoint) &&
    isAllowedDiscoveredEndpoint(metadata.jwks_uri)
  );
}

export async function discoverOidcProvider(config: OidcConfig, now: number = Date.now()): Promise<OidcDiscoveryResult> {
  const key = cacheKey(config);
  const cached = oidcProviderByIssuerAndClient.get(key);
  if (cached && cached.clientSecret === config.clientSecret && cached.expiresAt > now) {
    return { ok: true, provider: cached.provider };
  }
  if (cached) {
    oidcProviderByIssuerAndClient.delete(key);
  }

  let configuration: oidc.Configuration;
  try {
    configuration = await oidc.discovery(
      new URL(config.issuer),
      config.clientId,
      undefined,
      oidc.ClientSecretPost(config.clientSecret),
      discoveryOptions(config),
    );
  } catch {
    return { ok: false, reason: "discovery_failed" };
  }

  if (!hasRequiredSecureEndpoints(configuration)) {
    return { ok: false, reason: "invalid_endpoint" };
  }

  const provider = { configuration };
  oidcProviderByIssuerAndClient.set(key, {
    provider,
    clientSecret: config.clientSecret,
    expiresAt: now + DISCOVERY_CACHE_TTL_MS,
  });
  return { ok: true, provider };
}

export interface TokenExchangeResponse {
  claims: oidc.IDToken;
}

export type ExchangeError = "token_exchange_failed" | "invalid_id_token";

export type ExchangeResult = { ok: true; tokens: TokenExchangeResponse } | { ok: false; reason: ExchangeError };

export async function exchangeAuthorizationCode(
  provider: OidcProvider,
  options: { callbackUrl: string; codeVerifier: string; state: string; nonce: string },
): Promise<ExchangeResult> {
  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    tokens = await oidc.authorizationCodeGrant(provider.configuration, new URL(options.callbackUrl), {
      expectedNonce: options.nonce,
      expectedState: options.state,
      pkceCodeVerifier: options.codeVerifier,
    });
  } catch (error) {
    if (error instanceof oidc.ClientError) {
      return { ok: false, reason: "invalid_id_token" };
    }
    return { ok: false, reason: "token_exchange_failed" };
  }

  const claims = tokens.claims();
  if (!claims) {
    return { ok: false, reason: "invalid_id_token" };
  }
  return { ok: true, tokens: { claims } };
}

export interface VerifiedIdToken {
  sub: string;
}

export type VerifyError = "missing_sub" | "sub_not_allowed";

export type VerifyResult = { ok: true; verified: VerifiedIdToken } | { ok: false; reason: VerifyError };

export function verifyIdTokenClaims(config: OidcConfig, claims: oidc.IDToken): VerifyResult {
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    return { ok: false, reason: "missing_sub" };
  }
  if (!config.operatorSubs.includes(claims.sub)) {
    return { ok: false, reason: "sub_not_allowed" };
  }
  return { ok: true, verified: { sub: claims.sub } };
}

export function buildAuthorizeUrl(
  provider: OidcProvider,
  options: { redirectUri: string; state: string; nonce: string; codeChallenge: string },
): string {
  return oidc
    .buildAuthorizationUrl(provider.configuration, {
      code_challenge: options.codeChallenge,
      code_challenge_method: "S256",
      nonce: options.nonce,
      redirect_uri: options.redirectUri,
      scope: "openid profile email",
      state: options.state,
    })
    .toString();
}

export function buildCallbackUrl(requestUrl: string): string {
  return `${new URL(requestUrl).origin}/api/public/admin/callback`;
}

export function generateState(): string {
  return oidc.randomState();
}

export function generateNonce(): string {
  return oidc.randomNonce();
}

export function clearOidcCachesForTesting() {
  oidcProviderByIssuerAndClient.clear();
}
