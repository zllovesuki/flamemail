import { describe, expect, it } from "vitest";
import { buildExternalLinkRedirectHref } from "@/client/lib/external-link";
import { createBlockedImagePlaceholder, sanitizeElementAttributes } from "@/client/lib/email-html/dom";

function createDocument() {
  return new DOMParser().parseFromString("<html><body></body></html>", "text/html");
}

describe("createBlockedImagePlaceholder", () => {
  it("includes the provided alt text in the placeholder message", () => {
    const doc = createDocument();

    const placeholder = createBlockedImagePlaceholder(doc, "Hero image");

    expect(placeholder.getAttribute("data-remote-blocked")).toBe("image");
    expect(placeholder.textContent).toBe("Remote image blocked: Hero image");
  });

  it("falls back to the generic placeholder message when alt text is missing", () => {
    const doc = createDocument();

    const placeholder = createBlockedImagePlaceholder(doc, null);

    expect(placeholder.textContent).toBe("Remote image blocked. Load remote content to display it.");
  });
});

describe("sanitizeElementAttributes", () => {
  it("removes event handlers, srcdoc, and unsafe navigation urls", () => {
    const doc = createDocument();
    const element = doc.createElement("a");
    element.setAttribute("onclick", "alert('xss')");
    element.setAttribute("srcdoc", "<p>bad</p>");
    element.setAttribute("href", "javascript:alert('xss')");

    const blockedRemoteContent = sanitizeElementAttributes(element, false);

    expect(blockedRemoteContent).toBe(false);
    expect(element.hasAttribute("onclick")).toBe(false);
    expect(element.hasAttribute("srcdoc")).toBe(false);
    expect(element.hasAttribute("href")).toBe(false);
  });

  it("rewrites remote navigation links through the external redirect", () => {
    const doc = createDocument();
    const element = doc.createElement("a");
    element.setAttribute("href", "https://example.com/path?q=1");

    const blockedRemoteContent = sanitizeElementAttributes(element, false);

    expect(blockedRemoteContent).toBe(false);
    expect(element.getAttribute("href")).toBe(buildExternalLinkRedirectHref("https://example.com/path?q=1"));
  });

  it("preserves allowed mailto navigation urls", () => {
    const doc = createDocument();
    const element = doc.createElement("a");
    element.setAttribute("href", "mailto:test@example.com");

    const blockedRemoteContent = sanitizeElementAttributes(element, false);

    expect(blockedRemoteContent).toBe(false);
    expect(element.getAttribute("href")).toBe("mailto:test@example.com");
  });

  it("sanitizes inline styles and reports blocked remote content", () => {
    const doc = createDocument();
    const element = doc.createElement("div");
    element.setAttribute(
      "style",
      "background-image:url('https://images.example.com/hero.png'); color: blue; expression(alert('xss'))",
    );

    const blockedRemoteContent = sanitizeElementAttributes(element, false);

    expect(blockedRemoteContent).toBe(true);
    expect(element.getAttribute("style")).toContain("background-image:none");
    expect(element.getAttribute("style")).toContain("color: blue");
    expect(element.getAttribute("style")).not.toContain("expression");
  });

  it("removes remote auto-loading attributes when remote content is disabled", () => {
    const doc = createDocument();
    const element = doc.createElement("img");
    element.setAttribute("src", "https://images.example.com/hero.png");
    element.setAttribute("srcset", "https://images.example.com/hero.png 1x");
    element.setAttribute("poster", "https://images.example.com/poster.png");

    const blockedRemoteContent = sanitizeElementAttributes(element, false);

    expect(blockedRemoteContent).toBe(true);
    expect(element.hasAttribute("src")).toBe(false);
    expect(element.hasAttribute("srcset")).toBe(false);
    expect(element.hasAttribute("poster")).toBe(false);
  });

  it("preserves inline resources and remote sources when remote content is enabled", () => {
    const doc = createDocument();
    const inlineImage = doc.createElement("img");
    inlineImage.setAttribute("src", "cid:inline-image");

    const remoteImage = doc.createElement("img");
    remoteImage.setAttribute("src", "https://images.example.com/hero.png");
    remoteImage.setAttribute("srcset", "https://images.example.com/hero.png 1x");

    const inlineBlocked = sanitizeElementAttributes(inlineImage, false);
    const remoteBlocked = sanitizeElementAttributes(remoteImage, true);

    expect(inlineBlocked).toBe(false);
    expect(inlineImage.getAttribute("src")).toBe("cid:inline-image");
    expect(remoteBlocked).toBe(false);
    expect(remoteImage.getAttribute("src")).toBe("https://images.example.com/hero.png");
    expect(remoteImage.getAttribute("srcset")).toBe("https://images.example.com/hero.png 1x");
  });
});
