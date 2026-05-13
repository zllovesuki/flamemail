import { describe, expect, it } from "vitest";
import {
  decodeTransactionPayload,
  deriveTransactionCookieSecret,
  encodeTransactionPayload,
} from "@/worker/services/oidc";

describe("OIDC transaction payload encoding", () => {
  it("derives a deterministic purpose-scoped signing secret", async () => {
    const first = await deriveTransactionCookieSecret("client-secret");
    const second = await deriveTransactionCookieSecret("client-secret");
    const different = await deriveTransactionCookieSecret("other-client-secret");

    expect(first.byteLength).toBe(32);
    expect([...first]).toEqual([...second]);
    expect([...first]).not.toEqual([...different]);
  });

  it("round-trips a payload within TTL", () => {
    const createdAt = Date.now();
    const encoded = encodeTransactionPayload({
      state: "state-1",
      nonce: "nonce-1",
      codeVerifier: "verifier-1",
      redirectUri: "https://flamemail.devbin.tools/api/public/admin/callback",
      createdAt,
    });

    expect(decodeTransactionPayload(encoded, createdAt + 60_000)).toEqual({
      ok: true,
      payload: {
        state: "state-1",
        nonce: "nonce-1",
        codeVerifier: "verifier-1",
        redirectUri: "https://flamemail.devbin.tools/api/public/admin/callback",
        createdAt,
      },
    });
  });

  it("rejects an expired payload", () => {
    const createdAt = Date.now();
    const encoded = encodeTransactionPayload({
      state: "state-1",
      nonce: "nonce-1",
      codeVerifier: "verifier-1",
      redirectUri: "https://flamemail.devbin.tools/api/public/admin/callback",
      createdAt,
    });

    expect(decodeTransactionPayload(encoded, createdAt + 6 * 60 * 1000)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects malformed input", () => {
    expect(decodeTransactionPayload("not-base64-!!")).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(decodeTransactionPayload("AAAA")).toEqual({
      ok: false,
      reason: "invalid_payload",
    });
  });
});
