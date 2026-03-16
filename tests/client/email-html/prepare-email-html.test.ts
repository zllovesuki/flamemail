import { describe, expect, it } from "vitest";
import { buildExternalLinkRedirectHref } from "@/client/lib/external-link";
import { prepareEmailHtml } from "@/client/lib/email-html";

function parsePreparedHtml(result: ReturnType<typeof prepareEmailHtml>) {
  return new DOMParser().parseFromString(
    `<html><head>${result.headHtml}</head><body ${result.bodyAttributes}>${result.html}</body></html>`,
    "text/html",
  );
}

describe("prepareEmailHtml", () => {
  it("sanitizes hostile markup and blocks remote content by default", () => {
    const result = prepareEmailHtml(
      `
        <html>
          <head>
            <style>
              @import url("https://cdn.example.com/theme.css");
              body { background-image: url("https://cdn.example.com/background.png"); color: red; }
            </style>
          </head>
          <body onclick="alert('xss')" style="background-image:url('https://cdn.example.com/body.png'); color: blue;">
            <script>alert("xss")</script>
            <iframe src="https://evil.example/frame"></iframe>
            <svg><circle /></svg>
            <a id="remote" href="https://example.com/path?q=1">Remote link</a>
            <a id="mailto" href="mailto:test@example.com">Mail</a>
            <a id="tel" href="tel:+15555550123">Call</a>
            <a id="unsafe" href="javascript:alert('xss')">Unsafe</a>
            <img src="https://images.example.com/hero.png" alt="Hero image" />
            <img id="inline-image" src="cid:hero-image" alt="Inline image" />
            <div id="srcdoc-holder" srcdoc="<p>bad</p>"></div>
          </body>
        </html>
      `,
      false,
    );

    const document = parsePreparedHtml(result);
    const remoteLink = document.querySelector<HTMLAnchorElement>("#remote");
    const mailtoLink = document.querySelector<HTMLAnchorElement>("#mailto");
    const telLink = document.querySelector<HTMLAnchorElement>("#tel");
    const unsafeLink = document.querySelector<HTMLAnchorElement>("#unsafe");
    const blockedImage = document.querySelector<HTMLElement>('[data-remote-blocked="image"]');
    const inlineImage = document.querySelector<HTMLImageElement>("#inline-image");
    const srcdocHolder = document.querySelector<HTMLElement>("#srcdoc-holder");

    expect(result.blockedRemoteContent).toBe(true);
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector("svg")).toBeNull();
    expect(document.body.hasAttribute("onclick")).toBe(false);
    expect(document.body.getAttribute("style")).toContain("background-image:none");
    expect(document.body.getAttribute("style")).toContain("color: blue");
    expect(result.headHtml).toContain("background-image: none");
    expect(result.headHtml).not.toContain("https://cdn.example.com/theme.css");
    expect(remoteLink?.getAttribute("href")).toBe(buildExternalLinkRedirectHref("https://example.com/path?q=1"));
    expect(remoteLink?.getAttribute("target")).toBe("_blank");
    expect(remoteLink?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(mailtoLink?.getAttribute("href")).toBe("mailto:test@example.com");
    expect(telLink?.getAttribute("href")).toBe("tel:+15555550123");
    expect(unsafeLink?.hasAttribute("href")).toBe(false);
    expect(blockedImage?.textContent).toContain("Remote image blocked: Hero image");
    expect(inlineImage?.getAttribute("src")).toBe("cid:hero-image");
    expect(srcdocHolder?.hasAttribute("srcdoc")).toBe(false);
  });

  it("allows remote content when explicitly enabled while preserving other safety rules", () => {
    const result = prepareEmailHtml(
      `
        <html>
          <head>
            <style>
              body { background-image: url("https://cdn.example.com/background.png"); }
            </style>
          </head>
          <body>
            <a id="remote" href="https://example.com/path?q=1">Remote link</a>
            <a id="unsafe" href="file:///tmp/secrets.txt">Unsafe</a>
            <img id="remote-image" src="https://images.example.com/hero.png" alt="Hero image" />
          </body>
        </html>
      `,
      true,
    );

    const document = parsePreparedHtml(result);
    const remoteLink = document.querySelector<HTMLAnchorElement>("#remote");
    const unsafeLink = document.querySelector<HTMLAnchorElement>("#unsafe");
    const remoteImage = document.querySelector<HTMLImageElement>("#remote-image");

    expect(result.blockedRemoteContent).toBe(false);
    expect(result.headHtml).toContain("https://cdn.example.com/background.png");
    expect(remoteImage?.getAttribute("src")).toBe("https://images.example.com/hero.png");
    expect(remoteLink?.getAttribute("href")).toBe(buildExternalLinkRedirectHref("https://example.com/path?q=1"));
    expect(unsafeLink?.hasAttribute("href")).toBe(false);
    expect(document.querySelector('[data-remote-blocked="image"]')).toBeNull();
  });

  it("preserves inline resources and does not report blocked remote content when none exists", () => {
    const result = prepareEmailHtml(
      `
        <html>
          <body dir="rtl" lang="ar">
            <img id="inline-image" src="data:image/png;base64,abc123" alt="Inline" />
            <a id="mailto" href="mailto:test@example.com">Mail</a>
            <a id="tel" href="tel:+15555550123">Call</a>
          </body>
        </html>
      `,
      false,
    );

    const document = parsePreparedHtml(result);

    expect(result.blockedRemoteContent).toBe(false);
    expect(document.body.getAttribute("dir")).toBe("rtl");
    expect(document.body.getAttribute("lang")).toBe("ar");
    expect(document.querySelector("#inline-image")?.getAttribute("src")).toBe("data:image/png;base64,abc123");
    expect(document.querySelector("#mailto")?.getAttribute("href")).toBe("mailto:test@example.com");
    expect(document.querySelector("#tel")?.getAttribute("href")).toBe("tel:+15555550123");
  });
});
