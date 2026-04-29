export const INBOX_SESSIONS_KEY = "flamemail.inboxSessions";
export const INBOX_TOKEN_KEY_PREFIX = "flamemail.inboxToken";
export const D1_BOOKMARKS_KEY = "flamemail.d1Bookmarks";
export const ADMIN_BOOKMARK_SCOPE = "admin";

export interface Decoder<T> {
  assertDecode(value: unknown): T;
}

export type AuthDescriptor = { mode: "user"; token: string } | { mode: "admin" };

export interface ApiRequestOptions extends RequestInit {
  token?: string;
  bookmarkScope?: string;
  onBookmark?: (bookmark: string | null) => void;
}
