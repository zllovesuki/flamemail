import { describe, expect, it } from "vitest";
import {
  isAllowedInlineResourceUrl,
  isAllowedNavigationUrl,
  isRemoteResourceUrl,
  isUnsafeUrl,
  stripQuotes,
} from "@/client/lib/email-html/url-policy";

describe("stripQuotes", () => {
  it("trims surrounding whitespace and quotes", () => {
    expect(stripQuotes("  'https://example.com/path'  ")).toBe("https://example.com/path");
    expect(stripQuotes('  "cid:image"  ')).toBe("cid:image");
  });
});

describe("isUnsafeUrl", () => {
  it("rejects dangerous protocols and executable data html", () => {
    expect(isUnsafeUrl("javascript:alert(1)")).toBe(true);
    expect(isUnsafeUrl("vbscript:msgbox(1)")).toBe(true);
    expect(isUnsafeUrl("file:///tmp/secret.txt")).toBe(true);
    expect(isUnsafeUrl("data:text/html,<script>alert(1)</script>")).toBe(true);
    expect(isUnsafeUrl("data:application/xhtml+xml,<html></html>")).toBe(true);
  });

  it("does not treat safe resource urls as unsafe", () => {
    expect(isUnsafeUrl("https://example.com/asset.png")).toBe(false);
    expect(isUnsafeUrl("cid:inline-image")).toBe(false);
  });
});

describe("isAllowedInlineResourceUrl", () => {
  it("accepts inline-safe resource schemes", () => {
    expect(isAllowedInlineResourceUrl("data:image/png;base64,abc123")).toBe(true);
    expect(isAllowedInlineResourceUrl("cid:inline-image")).toBe(true);
    expect(isAllowedInlineResourceUrl("about:blank")).toBe(true);
    expect(isAllowedInlineResourceUrl("blob:https://example.com/123")).toBe(true);
  });

  it("rejects remote navigation urls", () => {
    expect(isAllowedInlineResourceUrl("https://example.com/asset.png")).toBe(false);
    expect(isAllowedInlineResourceUrl("mailto:test@example.com")).toBe(false);
  });
});

describe("isRemoteResourceUrl", () => {
  it("accepts http, https, and protocol-relative urls", () => {
    expect(isRemoteResourceUrl("https://example.com/image.png")).toBe(true);
    expect(isRemoteResourceUrl("http://example.com/image.png")).toBe(true);
    expect(isRemoteResourceUrl("//cdn.example.com/image.png")).toBe(true);
  });

  it("rejects inline and non-remote urls", () => {
    expect(isRemoteResourceUrl("cid:inline-image")).toBe(false);
    expect(isRemoteResourceUrl("/relative/path.png")).toBe(false);
    expect(isRemoteResourceUrl("#section")).toBe(false);
  });
});

describe("isAllowedNavigationUrl", () => {
  it("allows empty, fragment, remote, mailto, and tel navigation", () => {
    expect(isAllowedNavigationUrl("")).toBe(true);
    expect(isAllowedNavigationUrl("#details")).toBe(true);
    expect(isAllowedNavigationUrl("https://example.com/path")).toBe(true);
    expect(isAllowedNavigationUrl("//cdn.example.com/path")).toBe(true);
    expect(isAllowedNavigationUrl("mailto:test@example.com")).toBe(true);
    expect(isAllowedNavigationUrl("tel:+15555550123")).toBe(true);
  });

  it("rejects unsupported or unsafe navigation targets", () => {
    expect(isAllowedNavigationUrl("file:///tmp/secret.txt")).toBe(false);
    expect(isAllowedNavigationUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedNavigationUrl("/internal/path")).toBe(false);
  });
});
