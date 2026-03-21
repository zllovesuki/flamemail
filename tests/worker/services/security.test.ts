import { describe, expect, it } from "vitest";
import {
  constantTimeEqualStrings,
  decodeSessionRecord,
  decodeWebSocketTicket,
  getAdminPasswordConfigurationIssue,
  isAllowedWebSocketOrigin,
  withSecurityHeaders,
} from "@/worker/security";

describe("getAdminPasswordConfigurationIssue", () => {
  it("rejects missing, blank, placeholder, short, and weak passwords", () => {
    expect(getAdminPasswordConfigurationIssue(undefined)).toBe("missing");
    expect(getAdminPasswordConfigurationIssue("   ")).toBe("blank");
    expect(getAdminPasswordConfigurationIssue("change-me")).toBe("placeholder");
    expect(getAdminPasswordConfigurationIssue("Short1!")).toBe("too_short");
    expect(getAdminPasswordConfigurationIssue("alllowercasepassword")).toBe("insufficient_complexity");
  });

  it("accepts a sufficiently strong password", () => {
    expect(getAdminPasswordConfigurationIssue("AdminPassword123!")).toBeNull();
  });
});

describe("constantTimeEqualStrings", () => {
  it("returns true for matching values", () => {
    expect(constantTimeEqualStrings("match", "match")).toBe(true);
  });

  it("returns false for non-matching values with the same length", () => {
    expect(constantTimeEqualStrings("match", "patch")).toBe(false);
  });

  it("returns false for non-matching values with different lengths", () => {
    expect(constantTimeEqualStrings("match", "mismatch")).toBe(false);
  });
});

describe("withSecurityHeaders", () => {
  it("sets CSP, no-store, and HSTS headers for HTML over HTTPS", () => {
    const request = new Request("https://flamemail.devbin.tools/");
    const response = new Response("<html></html>", {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });

    const secured = withSecurityHeaders(request, response);

    expect(secured.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(secured.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(secured.headers.get("pragma")).toBe("no-cache");
    expect(secured.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(secured.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("sets no-store headers for API responses without adding CSP", () => {
    const request = new Request("https://flamemail.devbin.tools/api/public/config");
    const response = new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json",
      },
    });

    const secured = withSecurityHeaders(request, response);

    expect(secured.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(secured.headers.get("pragma")).toBe("no-cache");
    expect(secured.headers.get("content-security-policy")).toBeNull();
  });

  it("does not set HSTS for insecure requests", () => {
    const request = new Request("http://flamemail.devbin.tools/");
    const response = new Response("<html></html>", {
      headers: {
        "content-type": "text/html",
      },
    });

    const secured = withSecurityHeaders(request, response);

    expect(secured.headers.get("strict-transport-security")).toBeNull();
  });
});

describe("isAllowedWebSocketOrigin", () => {
  it("accepts matching origins", () => {
    const request = new Request("https://flamemail.devbin.tools/ws", {
      headers: {
        origin: "https://flamemail.devbin.tools",
      },
    });

    expect(isAllowedWebSocketOrigin(request)).toBe(true);
  });

  it("rejects missing origins", () => {
    const request = new Request("https://flamemail.devbin.tools/ws");

    expect(isAllowedWebSocketOrigin(request)).toBe(false);
  });

  it("rejects mismatched origins", () => {
    const request = new Request("https://flamemail.devbin.tools/ws", {
      headers: {
        origin: "https://evil.example",
      },
    });

    expect(isAllowedWebSocketOrigin(request)).toBe(false);
  });
});

describe("decodeWebSocketTicket", () => {
  it("decodes valid ticket payloads", () => {
    const raw = JSON.stringify({
      address: "user@example.com",
      session: {
        type: "user",
        address: "user@example.com",
      },
    });

    expect(decodeWebSocketTicket(raw)).toEqual({
      address: "user@example.com",
      session: {
        type: "user",
        address: "user@example.com",
      },
    });
  });

  it("returns null for invalid json and invalid shapes", () => {
    expect(decodeWebSocketTicket("{")).toBeNull();
    expect(
      decodeWebSocketTicket(
        JSON.stringify({
          address: "user@example.com",
          session: {
            type: "user",
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("decodeSessionRecord", () => {
  it("decodes valid session payloads", () => {
    expect(
      decodeSessionRecord(
        JSON.stringify({
          type: "admin",
        }),
      ),
    ).toEqual({
      type: "admin",
    });
  });

  it("returns null for invalid json and invalid shapes", () => {
    expect(decodeSessionRecord("{")).toBeNull();
    expect(
      decodeSessionRecord(
        JSON.stringify({
          type: "user",
        }),
      ),
    ).toBeNull();
  });
});
