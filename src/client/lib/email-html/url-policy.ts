export function stripQuotes(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

export function isUnsafeUrl(value: string) {
  const normalized = stripQuotes(value).trim().toLowerCase();
  return (
    normalized.startsWith("javascript:") ||
    normalized.startsWith("vbscript:") ||
    normalized.startsWith("file:") ||
    normalized.startsWith("data:text/html") ||
    normalized.startsWith("data:application/xhtml+xml")
  );
}

export function isAllowedInlineResourceUrl(value: string) {
  const normalized = stripQuotes(value).trim().toLowerCase();
  return (
    normalized.startsWith("data:") ||
    normalized.startsWith("cid:") ||
    normalized.startsWith("about:") ||
    normalized.startsWith("blob:")
  );
}

export function isRemoteResourceUrl(value: string) {
  const normalized = stripQuotes(value).trim().toLowerCase();
  return normalized.startsWith("https://") || normalized.startsWith("http://") || normalized.startsWith("//");
}

export function isAllowedNavigationUrl(value: string) {
  const normalized = stripQuotes(value).trim().toLowerCase();

  if (!normalized || normalized.startsWith("#")) {
    return true;
  }

  return (
    normalized.startsWith("https://") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("//") ||
    normalized.startsWith("mailto:") ||
    normalized.startsWith("tel:")
  );
}
