export const INBOX_SESSIONS_KEY = "flamemail.inboxSessions";
export const INBOX_TOKEN_KEY_PREFIX = "flamemail.inboxToken";
export const ADMIN_TOKEN_KEY = "flamemail.adminToken";
export const D1_BOOKMARKS_KEY = "flamemail.d1Bookmarks";
export const ADMIN_BOOKMARK_SCOPE = "admin";

export interface Decoder<T> {
  assertDecode(value: unknown): T;
}

export interface ApiRequestOptions extends RequestInit {
  token?: string;
  bookmarkScope?: string;
  onBookmark?: (bookmark: string | null) => void;
}
