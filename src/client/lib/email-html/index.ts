import { sanitizeStyleSheet } from "./css";
import { BLOCKED_TAGS, createBlockedImagePlaceholder, sanitizeElementAttributes } from "./dom";
import { serializeBodyAttributes, serializeStyleTag } from "./serialize";
import { isAllowedInlineResourceUrl, isRemoteResourceUrl } from "./url-policy";

export interface PreparedEmailHtml {
  headHtml: string;
  html: string;
  bodyAttributes: string;
  blockedRemoteContent: boolean;
}

export function prepareEmailHtml(rawHtml: string, allowRemoteContent: boolean): PreparedEmailHtml {
  if (typeof DOMParser === "undefined") {
    return {
      headHtml: "",
      html: "",
      bodyAttributes: "",
      blockedRemoteContent: false,
    };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, "text/html");
  let blockedRemoteContent = sanitizeElementAttributes(doc.body, allowRemoteContent);
  const headStyles: string[] = [];

  for (const element of Array.from(doc.head.querySelectorAll("style"))) {
    const sanitized = sanitizeStyleSheet(element.textContent ?? "", allowRemoteContent);
    blockedRemoteContent = blockedRemoteContent || sanitized.blockedRemoteContent;

    if (sanitized.css) {
      headStyles.push(serializeStyleTag(sanitized.css));
    }
  }

  for (const element of Array.from(doc.body.querySelectorAll("*"))) {
    const tagName = element.tagName.toLowerCase();

    if (BLOCKED_TAGS.has(tagName)) {
      element.remove();
      continue;
    }

    if (tagName === "style") {
      const sanitized = sanitizeStyleSheet(element.textContent ?? "", allowRemoteContent);
      blockedRemoteContent = blockedRemoteContent || sanitized.blockedRemoteContent;

      if (!sanitized.css) {
        element.remove();
        continue;
      }

      element.textContent = sanitized.css;
      continue;
    }

    if (tagName === "img") {
      const src = element.getAttribute("src");
      if (src && !isAllowedInlineResourceUrl(src)) {
        if (!allowRemoteContent && isRemoteResourceUrl(src)) {
          blockedRemoteContent = true;
          element.replaceWith(createBlockedImagePlaceholder(doc, element.getAttribute("alt")));
          continue;
        }

        if (!isRemoteResourceUrl(src)) {
          element.removeAttribute("src");
        }
      }
    }

    blockedRemoteContent = sanitizeElementAttributes(element, allowRemoteContent) || blockedRemoteContent;

    if (element.hasAttribute("href") || element.hasAttribute("xlink:href")) {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer nofollow");
    }
  }

  return {
    headHtml: headStyles.join(""),
    html: doc.body.innerHTML,
    bodyAttributes: serializeBodyAttributes(doc.body),
    blockedRemoteContent,
  };
}
