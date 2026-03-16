function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function serializeBodyAttributes(body: HTMLElement) {
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

export function serializeStyleTag(value: string) {
  return `<style>${value.replace(/<\/style/gi, "<\\/style")}</style>`;
}
