import { SessionRecord, WebSocketTicketRecord } from "@/shared/contracts";

const APP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' https://fonts.gstatic.com data:",
  "connect-src 'self' ws: wss:",
  "frame-src 'self' blob: https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

export const ADMIN_ACCESS_UNAVAILABLE_MESSAGE =
  "Admin access is unavailable because tessera OIDC is not configured or cannot be discovered.";

export class PublicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicError";
  }
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackHostname(hostname: string) {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

export function getPublicErrorMessage(error: unknown, fallback: string) {
  if (error instanceof PublicError) {
    return error.message;
  }

  return fallback;
}

export function issueNoStoreHeaders(headers: Headers) {
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Pragma", "no-cache");
}

export function withSecurityHeaders(request: Request, response: Response) {
  const headers = new Headers(response.headers);
  const url = new URL(request.url);
  const contentType = headers.get("content-type") ?? "";
  const isHtml = contentType.includes("text/html");
  const isApiRoute = url.pathname.startsWith("/api/");

  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set(
    "Permissions-Policy",
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  );

  if (url.protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  if (isApiRoute || isHtml) {
    issueNoStoreHeaders(headers);
  }

  if (isHtml) {
    headers.set("Content-Security-Policy", APP_CONTENT_SECURITY_POLICY);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function isAllowedWebSocketOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }

  const url = new URL(request.url);
  return origin === url.origin;
}

export function decodeWebSocketTicket(raw: string | null) {
  if (!raw) {
    return null;
  }

  try {
    return WebSocketTicketRecord.assertDecode(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function decodeSessionRecord(raw: string | null) {
  if (!raw) {
    return null;
  }

  try {
    return SessionRecord.assertDecode(JSON.parse(raw));
  } catch {
    return null;
  }
}
