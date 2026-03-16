function normalizeExternalLinkTarget(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

export function buildExternalLinkRedirectHref(value: string) {
  return `/link?url=${encodeURIComponent(normalizeExternalLinkTarget(value))}`;
}

export function parseExternalLinkTarget(rawTarget: string | null) {
  if (!rawTarget) {
    return null;
  }

  try {
    const target = new URL(rawTarget, window.location.origin);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return null;
    }

    return target;
  } catch {
    return null;
  }
}
