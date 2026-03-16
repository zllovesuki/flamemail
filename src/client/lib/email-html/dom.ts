import { buildExternalLinkRedirectHref } from "@/client/lib/external-link";
import { sanitizeCssValue, sanitizeSrcSet } from "./css";
import { isAllowedInlineResourceUrl, isAllowedNavigationUrl, isRemoteResourceUrl, isUnsafeUrl } from "./url-policy";

export const BLOCKED_TAGS = new Set([
  "base",
  "button",
  "canvas",
  "embed",
  "form",
  "frame",
  "iframe",
  "input",
  "link",
  "math",
  "meta",
  "object",
  "script",
  "select",
  "svg",
  "textarea",
]);

const AUTO_LOAD_ATTRIBUTES = new Set(["background", "poster", "src", "srcset"]);
const URL_ATTRIBUTES = new Set(["action", "background", "formaction", "href", "poster", "src", "srcset", "xlink:href"]);
const NAVIGATION_ATTRIBUTES = new Set(["action", "formaction", "href", "xlink:href"]);

export function createBlockedImagePlaceholder(doc: Document, altText: string | null) {
  const placeholder = doc.createElement("div");
  placeholder.setAttribute("data-remote-blocked", "image");
  placeholder.textContent = altText
    ? `Remote image blocked: ${altText}`
    : "Remote image blocked. Load remote content to display it.";
  return placeholder;
}

export function sanitizeElementAttributes(element: Element, allowRemoteContent: boolean) {
  let blockedRemoteContent = false;

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value;

    if (name.startsWith("on") || name === "srcdoc") {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (name === "style") {
      const sanitized = sanitizeCssValue(value, allowRemoteContent);
      blockedRemoteContent = blockedRemoteContent || sanitized.blockedRemoteContent;
      if (sanitized.css) {
        element.setAttribute(attribute.name, sanitized.css);
      } else {
        element.removeAttribute(attribute.name);
      }
      continue;
    }

    if (!URL_ATTRIBUTES.has(name)) {
      continue;
    }

    if (isUnsafeUrl(value)) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (NAVIGATION_ATTRIBUTES.has(name)) {
      if (!isAllowedNavigationUrl(value)) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (isRemoteResourceUrl(value)) {
        element.setAttribute(attribute.name, buildExternalLinkRedirectHref(value));
      }

      continue;
    }

    if (name === "srcset") {
      const nextValue = sanitizeSrcSet(value, allowRemoteContent);
      if (nextValue) {
        element.setAttribute(attribute.name, nextValue);
      } else {
        blockedRemoteContent = blockedRemoteContent || value.trim().length > 0;
        element.removeAttribute(attribute.name);
      }
      continue;
    }

    if (isAllowedInlineResourceUrl(value)) {
      continue;
    }

    if (allowRemoteContent && isRemoteResourceUrl(value)) {
      continue;
    }

    if (AUTO_LOAD_ATTRIBUTES.has(name) && isRemoteResourceUrl(value)) {
      blockedRemoteContent = true;
    }

    element.removeAttribute(attribute.name);
  }

  return blockedRemoteContent;
}
