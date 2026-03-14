export interface PreparedEmailHtml {
  headHtml: string;
  html: string;
  bodyAttributes: string;
  blockedRemoteContent: boolean;
}

const BLOCKED_TAGS = new Set([
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

function stripQuotes(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function isUnsafeUrl(value: string) {
  const normalized = stripQuotes(value).trim().toLowerCase();
  return normalized.startsWith("javascript:")
    || normalized.startsWith("vbscript:")
    || normalized.startsWith("file:")
    || normalized.startsWith("data:text/html")
    || normalized.startsWith("data:application/xhtml+xml");
}

function isAllowedInlineResourceUrl(value: string) {
  const normalized = stripQuotes(value).trim().toLowerCase();
  return normalized.startsWith("data:")
    || normalized.startsWith("cid:")
    || normalized.startsWith("about:")
    || normalized.startsWith("blob:");
}

function isRemoteResourceUrl(value: string) {
  const normalized = stripQuotes(value).trim().toLowerCase();
  return normalized.startsWith("https://")
    || normalized.startsWith("http://")
    || normalized.startsWith("//");
}

function isAllowedNavigationUrl(value: string) {
  const normalized = stripQuotes(value).trim().toLowerCase();

  if (!normalized || normalized.startsWith("#")) {
    return true;
  }

  return normalized.startsWith("https://")
    || normalized.startsWith("http://")
    || normalized.startsWith("//")
    || normalized.startsWith("mailto:")
    || normalized.startsWith("tel:");
}

function buildRedirectHref(value: string) {
  return `/link?url=${encodeURIComponent(stripQuotes(value).trim())}`;
}

function sanitizeCssValue(value: string, allowRemoteContent: boolean) {
  let blockedRemoteContent = false;

  const css = value
    .replace(/@import[\s\S]*?;/gi, (match) => {
      blockedRemoteContent = blockedRemoteContent || /https?:|\/\//i.test(match);
      return "";
    })
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/url\(([^)]+)\)/gi, (_match, rawUrl: string) => {
      const nextUrl = stripQuotes(rawUrl);

      if (isUnsafeUrl(nextUrl)) {
        return "none";
      }

      if (isAllowedInlineResourceUrl(nextUrl)) {
        return `url("${nextUrl}")`;
      }

      if (allowRemoteContent && isRemoteResourceUrl(nextUrl)) {
        return `url("${nextUrl}")`;
      }

      if (isRemoteResourceUrl(nextUrl)) {
        blockedRemoteContent = true;
      }

      return "none";
    })
    .trim();

  return {
    css,
    blockedRemoteContent,
  };
}

function sanitizeSrcSet(value: string, allowRemoteContent: boolean) {
  const sources = value
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .flatMap((candidate) => {
      const [rawUrl, ...rest] = candidate.split(/\s+/);
      const url = stripQuotes(rawUrl ?? "");

      if (!url || isUnsafeUrl(url)) {
        return [] as string[];
      }

      if (isAllowedInlineResourceUrl(url) || (allowRemoteContent && isRemoteResourceUrl(url))) {
        return [rest.length > 0 ? `${url} ${rest.join(" ")}` : url];
      }

      return [] as string[];
    });

  return sources.join(", ");
}

function createBlockedImagePlaceholder(doc: Document, altText: string | null) {
  const placeholder = doc.createElement("div");
  placeholder.setAttribute("data-remote-blocked", "image");
  placeholder.textContent = altText
    ? `Remote image blocked: ${altText}`
    : "Remote image blocked. Load remote content to display it.";
  return placeholder;
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeStyleSheet(value: string, allowRemoteContent: boolean) {
  const sanitized = sanitizeCssValue(value, allowRemoteContent);

  return {
    css: sanitized.css.replace(/behavior\s*:[^;]+;?/gi, "").trim(),
    blockedRemoteContent: sanitized.blockedRemoteContent,
  };
}

function sanitizeElementAttributes(element: Element, allowRemoteContent: boolean) {
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
        element.setAttribute(attribute.name, buildRedirectHref(value));
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

function serializeBodyAttributes(body: HTMLElement) {
  const attributes = ["dir", "lang", "style"]
    .map((name) => {
      const value = body.getAttribute(name);
      if (!value) {
        return null;
      }

      return `${name}="${escapeHtmlAttribute(value)}"`;
    })
    .filter((value): value is string => Boolean(value));

  return attributes.join(" ");
}

function serializeStyleTag(value: string) {
  return `<style>${value.replace(/<\/style/gi, "<\\/style")}</style>`;
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
