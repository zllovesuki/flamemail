import { isAllowedInlineResourceUrl, isRemoteResourceUrl, isUnsafeUrl, stripQuotes } from "./url-policy";

export function sanitizeCssValue(value: string, allowRemoteContent: boolean) {
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

export function sanitizeStyleSheet(value: string, allowRemoteContent: boolean) {
  const sanitized = sanitizeCssValue(value, allowRemoteContent);

  return {
    css: sanitized.css.replace(/behavior\s*:[^;]+;?/gi, "").trim(),
    blockedRemoteContent: sanitized.blockedRemoteContent,
  };
}

export function sanitizeSrcSet(value: string, allowRemoteContent: boolean) {
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
