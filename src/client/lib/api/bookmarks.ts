import { D1_BOOKMARK_HEADER } from "@/shared/d1";
import { D1_BOOKMARKS_KEY, type ApiRequestOptions } from "./shared";

export function getInboxBookmarkScope(address: string) {
  return `inbox:${address}`;
}

function parseStoredBookmarks() {
  try {
    const raw = localStorage.getItem(D1_BOOKMARKS_KEY);
    if (!raw) {
      return {} as Record<string, string>;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {} as Record<string, string>;
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
      ),
    );
  } catch {
    return {} as Record<string, string>;
  }
}

function writeStoredBookmarks(bookmarks: Record<string, string>) {
  localStorage.setItem(D1_BOOKMARKS_KEY, JSON.stringify(bookmarks));
  return bookmarks;
}

export function getStoredBookmark(scope: string) {
  return parseStoredBookmarks()[scope] ?? null;
}

export function setStoredBookmark(scope: string, bookmark: string) {
  const next = parseStoredBookmarks();
  next[scope] = bookmark;
  writeStoredBookmarks(next);
}

export function clearStoredBookmark(scope: string) {
  const next = parseStoredBookmarks();
  if (!(scope in next)) {
    return;
  }

  delete next[scope];
  writeStoredBookmarks(next);
}

export function applyResponseBookmark(
  response: Response,
  options?: Pick<ApiRequestOptions, "bookmarkScope" | "onBookmark">,
) {
  const bookmark = response.headers.get(D1_BOOKMARK_HEADER)?.trim() || null;

  if (bookmark && options?.bookmarkScope) {
    setStoredBookmark(options.bookmarkScope, bookmark);
  }

  options?.onBookmark?.(bookmark);
}
