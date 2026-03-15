import {
  ADMIN_ACCESS_DISABLED_ERROR_CODE,
  AdminDomainRequest,
  AdminDomainStatusRequest,
  AdminDomainsResponse,
  AdminInboxesResponse,
  AdminLoginRequest,
  AdminTempInboxPage,
  CreateInboxRequest,
  CreateInboxResponse,
  DomainsResponse,
  EmailDetail,
  EmailPage,
  ErrorResponse,
  ExtendInboxRequest,
  ExtendInboxResponse,
  InboxInfo,
  InboxSession,
  InboxSessionSummary,
  InboxSessionSummaryList,
  OkResponse,
  PublicConfigResponse,
  TokenResponse,
  WebSocketTicketResponse,
  type AdminDomain,
  type AdminInbox,
  type AdminTempInbox,
  type AdminTempInboxPage as AdminTempInboxPageType,
  type EmailAttachment,
  type EmailDetail as EmailDetailType,
  type EmailSummary,
  type InboxInfo as InboxInfoType,
  type InboxSession as InboxSessionType,
  type InboxSessionSummary as InboxSessionSummaryType,
  type TempMailboxTtlHours,
} from "@/shared/contracts";
import { D1_BOOKMARK_HEADER } from "@/shared/d1";

export { TEMP_MAILBOX_TTL_HOURS } from "@/shared/contracts";
export { EMAIL_PAGE_SIZE } from "@/shared/contracts";
export type {
  AdminDomain,
  AdminInbox,
  AdminTempInbox,
  AdminTempInboxPageType as AdminTempInboxPage,
  EmailAttachment,
  EmailDetailType as EmailDetail,
  EmailSummary,
  InboxInfoType as InboxInfo,
  InboxSessionType as InboxSession,
  InboxSessionSummaryType as InboxSessionSummary,
  TempMailboxTtlHours,
};

const INBOX_SESSIONS_KEY = "flamemail.inboxSessions";
const INBOX_TOKEN_KEY_PREFIX = "flamemail.inboxToken";
const ADMIN_TOKEN_KEY = "flamemail.adminToken";
const D1_BOOKMARKS_KEY = "flamemail.d1Bookmarks";
const ADMIN_BOOKMARK_SCOPE = "admin";
let publicConfigPromise: Promise<{ turnstileSiteKey: string }> | null = null;

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface Decoder<T> {
  assertDecode(value: unknown): T;
}

interface ApiRequestOptions extends RequestInit {
  token?: string;
  bookmarkScope?: string;
  onBookmark?: (bookmark: string | null) => void;
}

async function parseError(response: Response) {
  const fallback = `${response.status} ${response.statusText}`.trim();

  try {
    const payload = ErrorResponse.assertDecode(await response.json());
    return {
      code: payload.code,
      message: payload.error ?? fallback,
    };
  } catch {
    return {
      message: fallback,
    };
  }
}

function encodeJsonBody<T>(decoder: Decoder<T>, value: unknown) {
  return JSON.stringify(decoder.assertDecode(value));
}

function getInboxBookmarkScope(address: string) {
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
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0),
    );
  } catch {
    return {} as Record<string, string>;
  }
}

function writeStoredBookmarks(bookmarks: Record<string, string>) {
  localStorage.setItem(D1_BOOKMARKS_KEY, JSON.stringify(bookmarks));
  return bookmarks;
}

function getStoredBookmark(scope: string) {
  return parseStoredBookmarks()[scope] ?? null;
}

function setStoredBookmark(scope: string, bookmark: string) {
  const next = parseStoredBookmarks();
  next[scope] = bookmark;
  writeStoredBookmarks(next);
}

function clearStoredBookmark(scope: string) {
  const next = parseStoredBookmarks();
  if (!(scope in next)) {
    return;
  }

  delete next[scope];
  writeStoredBookmarks(next);
}

function applyResponseBookmark(response: Response, options?: Pick<ApiRequestOptions, "bookmarkScope" | "onBookmark">) {
  const bookmark = response.headers.get(D1_BOOKMARK_HEADER)?.trim() || null;

  if (bookmark && options?.bookmarkScope) {
    setStoredBookmark(options.bookmarkScope, bookmark);
  }

  options?.onBookmark?.(bookmark);
}

async function fetchWithSession(path: string, options?: ApiRequestOptions) {
  const {
    token,
    bookmarkScope,
    onBookmark,
    ...requestInit
  } = options ?? {};
  const headers = new Headers(requestInit.headers);

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  if (bookmarkScope) {
    const bookmark = getStoredBookmark(bookmarkScope);
    if (bookmark) {
      headers.set(D1_BOOKMARK_HEADER, bookmark);
    }
  }

  const response = await fetch(path, {
    ...requestInit,
    headers,
  });

  applyResponseBookmark(response, { bookmarkScope, onBookmark });

  return response;
}

function shouldClearAdminToken(token: string | undefined, status: number, code?: string) {
  return code === ADMIN_ACCESS_DISABLED_ERROR_CODE
    || ((status === 401 || status === 403) && typeof token === "string" && token.length > 0 && getAdminToken() === token);
}

async function throwApiError(response: Response, token?: string): Promise<never> {
  const { code, message } = await parseError(response);

  if (shouldClearAdminToken(token, response.status, code)) {
    clearAdminToken();
  }

  throw new ApiError(message, response.status, code);
}

async function request<T>(path: string, decoder: Decoder<T>, options?: ApiRequestOptions) {
  const headers = new Headers(options?.headers);
  headers.set("accept", "application/json");

  if (options?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetchWithSession(path, {
    ...options,
    headers,
  });

  if (!response.ok) {
    await throwApiError(response, options?.token);
  }

  return decoder.assertDecode(await response.json());
}

export async function listDomains() {
  const response = await request("/api/domains", DomainsResponse);
  return response.domains;
}

export async function getPublicConfig() {
  if (!publicConfigPromise) {
    publicConfigPromise = request("/api/config", PublicConfigResponse).catch((error) => {
      publicConfigPromise = null;
      throw error;
    });
  }

  return publicConfigPromise;
}

export async function createInbox(domain: string, ttlHours: TempMailboxTtlHours, turnstileToken: string) {
  let bookmark: string | null = null;
  const response = await request("/api/inboxes", CreateInboxResponse, {
    method: "POST",
    body: encodeJsonBody(CreateInboxRequest, { domain, ttlHours, turnstileToken }),
    onBookmark: (value) => {
      bookmark = value;
    },
  });

  if (bookmark) {
    setStoredBookmark(getInboxBookmarkScope(response.address), bookmark);
  }

  return response;
}

export async function getInbox(address: string, token: string) {
  return request(`/api/inboxes/${encodeURIComponent(address)}`, InboxInfo, {
    token,
    bookmarkScope: getInboxBookmarkScope(address),
  });
}

export async function listEmails(
  address: string,
  token: string,
  options: {
    page?: number;
    includeTotal?: boolean;
  } = {},
) {
  const params = new URLSearchParams({
    page: String(options.page ?? 0),
  });

  if (options.includeTotal) {
    params.set("includeTotal", "1");
  }

  return request(`/api/inboxes/${encodeURIComponent(address)}/emails?${params.toString()}`, EmailPage, {
    token,
    bookmarkScope: getInboxBookmarkScope(address),
  });
}

export async function getEmail(address: string, emailId: string, token: string) {
  return request(
    `/api/inboxes/${encodeURIComponent(address)}/emails/${encodeURIComponent(emailId)}`,
    EmailDetail,
    {
      token,
      bookmarkScope: getInboxBookmarkScope(address),
    },
  );
}

export async function deleteEmail(address: string, emailId: string, token: string) {
  return request(
    `/api/inboxes/${encodeURIComponent(address)}/emails/${encodeURIComponent(emailId)}`,
    OkResponse,
    {
      method: "DELETE",
      token,
      bookmarkScope: getInboxBookmarkScope(address),
    },
  );
}

export async function deleteInbox(address: string, token: string) {
  return request(`/api/inboxes/${encodeURIComponent(address)}`, OkResponse, {
    method: "DELETE",
    token,
    bookmarkScope: getInboxBookmarkScope(address),
  });
}

export async function extendInbox(address: string, token: string, ttlHours: TempMailboxTtlHours) {
  return request(
    `/api/inboxes/${encodeURIComponent(address)}/extend`,
    ExtendInboxResponse,
    {
      method: "POST",
      token,
      bookmarkScope: getInboxBookmarkScope(address),
      body: encodeJsonBody(ExtendInboxRequest, { ttlHours }),
    },
  );
}

export async function createWebSocketTicket(address: string, token: string) {
  return request(`/api/inboxes/${encodeURIComponent(address)}/ws-ticket`, WebSocketTicketResponse, {
    method: "POST",
    token,
    bookmarkScope: getInboxBookmarkScope(address),
  });
}

export async function adminLogin(password: string, turnstileToken: string) {
  return request("/api/admin/login", TokenResponse, {
    method: "POST",
    body: encodeJsonBody(AdminLoginRequest, { password, turnstileToken }),
  });
}

export async function listAdminInboxes(token: string) {
  const response = await request("/api/admin/inboxes", AdminInboxesResponse, {
    token,
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
  });
  return response.inboxes;
}

export async function listAdminDomains(token: string) {
  const response = await request("/api/admin/domains", AdminDomainsResponse, {
    token,
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
  });
  return response.domains;
}

export async function listAdminTempInboxes(token: string, page = 0) {
  return request(`/api/admin/temp-inboxes?page=${page}`, AdminTempInboxPage, {
    token,
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
  });
}

export async function addAdminDomain(token: string, domain: string, isActive = true) {
  const response = await request("/api/admin/domains", AdminDomainsResponse, {
    method: "POST",
    token,
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
    body: encodeJsonBody(AdminDomainRequest, { domain, isActive }),
  });
  return response.domains;
}

export async function updateAdminDomain(token: string, domain: string, isActive: boolean) {
  return request(`/api/admin/domains/${encodeURIComponent(domain)}`, OkResponse, {
    method: "PATCH",
    token,
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
    body: encodeJsonBody(AdminDomainStatusRequest, { isActive }),
  });
}

export async function deleteAdminDomain(token: string, domain: string) {
  return request(`/api/admin/domains/${encodeURIComponent(domain)}`, OkResponse, {
    method: "DELETE",
    token,
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
  });
}

export async function downloadAttachment(
  address: string,
  emailId: string,
  attachmentId: string,
  token: string,
) {
  const response = await fetchWithSession(
    `/api/inboxes/${encodeURIComponent(address)}/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`,
    {
      token,
      bookmarkScope: getInboxBookmarkScope(address),
    },
  );

  if (!response.ok) {
    const { code, message } = await parseError(response);
    throw new ApiError(message, response.status, code);
  }

  return response.blob();
}

export async function getRawEmailSource(address: string, emailId: string, token: string) {
  const response = await fetchWithSession(
    `/api/inboxes/${encodeURIComponent(address)}/emails/${encodeURIComponent(emailId)}/raw`,
    {
      token,
      bookmarkScope: getInboxBookmarkScope(address),
    },
  );

  if (!response.ok) {
    const { code, message } = await parseError(response);
    throw new ApiError(message, response.status, code);
  }

  return response.text();
}

function getInboxTokenStorageKey(address: string) {
  return `${INBOX_TOKEN_KEY_PREFIX}:${address}`;
}

function clearStoredInboxToken(address: string) {
  localStorage.removeItem(getInboxTokenStorageKey(address));
  sessionStorage.removeItem(getInboxTokenStorageKey(address));
}

function clearStoredInboxBookmark(address: string) {
  clearStoredBookmark(getInboxBookmarkScope(address));
}

function isExpiredSession(expiresAt: string) {
  const expiresAtMs = Date.parse(expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now();
}

function readStoredInboxToken(address: string) {
  const storageKey = getInboxTokenStorageKey(address);
  const persistentToken = localStorage.getItem(storageKey);
  if (persistentToken) {
    return persistentToken;
  }

  const legacySessionToken = sessionStorage.getItem(storageKey);
  if (legacySessionToken) {
    localStorage.setItem(storageKey, legacySessionToken);
    sessionStorage.removeItem(storageKey);
    return legacySessionToken;
  }

  return null;
}

function writeStoredSessions(sessions: InboxSessionSummaryType[]) {
  const validated = InboxSessionSummaryList.assertDecode(sessions);
  localStorage.setItem(INBOX_SESSIONS_KEY, JSON.stringify(validated));
  return validated;
}

function parseStoredSessions() {
  try {
    const raw = localStorage.getItem(INBOX_SESSIONS_KEY);
    if (!raw) {
      return [] as InboxSessionSummaryType[];
    }

    return InboxSessionSummaryList.assertDecode(JSON.parse(raw));
  } catch {
    return [] as InboxSessionSummaryType[];
  }
}

function pruneExpiredSessions() {
  const sessions = parseStoredSessions();
  const activeSessions = sessions.filter((session) => {
    if (!isExpiredSession(session.expiresAt)) {
      return true;
    }

    clearStoredInboxToken(session.address);
    clearStoredInboxBookmark(session.address);
    return false;
  });

  if (activeSessions.length === sessions.length) {
    return sessions;
  }

  return writeStoredSessions(activeSessions);
}

export function loadInboxSessions() {
  return pruneExpiredSessions();
}

export function storeInboxSession(session: InboxSessionType) {
  const summary = InboxSessionSummary.assertDecode({
    address: session.address,
    ttlHours: session.ttlHours,
    expiresAt: session.expiresAt,
  });
  const next = writeStoredSessions([
    summary,
    ...pruneExpiredSessions().filter((item) => item.address !== session.address),
  ].slice(0, 8));

  localStorage.setItem(getInboxTokenStorageKey(session.address), session.token);
  sessionStorage.removeItem(getInboxTokenStorageKey(session.address));
  return next;
}

export function removeInboxSession(address: string) {
  const next = writeStoredSessions(parseStoredSessions().filter((item) => item.address !== address));
  clearStoredInboxToken(address);
  clearStoredInboxBookmark(address);
  return next;
}

export function getInboxSession(address: string) {
  const summary = pruneExpiredSessions().find((item) => item.address === address);

  if (!summary) {
    return null;
  }

  const token = readStoredInboxToken(address);

  if (!token) {
    return null;
  }

  try {
    return InboxSession.assertDecode({
      ...summary,
      token,
    });
  } catch {
    return null;
  }
}

export function updateInboxSession(address: string, updates: Partial<InboxSessionType>) {
  const next = writeStoredSessions(
    pruneExpiredSessions().map((item) =>
      item.address === address
        ? InboxSessionSummary.assertDecode({
            ...item,
            ...(typeof updates.ttlHours === "number" ? { ttlHours: updates.ttlHours } : {}),
            ...(typeof updates.expiresAt === "string" ? { expiresAt: updates.expiresAt } : {}),
          })
        : item,
    ),
  );

  if (typeof updates.token === "string") {
    localStorage.setItem(getInboxTokenStorageKey(address), updates.token);
    sessionStorage.removeItem(getInboxTokenStorageKey(address));
  }

  const updatedSession = next.find((item) => item.address === address);
  if (updatedSession && isExpiredSession(updatedSession.expiresAt)) {
    return removeInboxSession(address);
  }

  return next;
}

export function getAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token: string) {
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken() {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  clearStoredBookmark(ADMIN_BOOKMARK_SCOPE);
}

export function isAdminAccessDisabledError(error: unknown) {
  return error instanceof ApiError && error.code === ADMIN_ACCESS_DISABLED_ERROR_CODE;
}

export function isAdminSessionError(error: unknown) {
  return error instanceof ApiError
    && (error.code === ADMIN_ACCESS_DISABLED_ERROR_CODE || error.status === 401 || error.status === 403);
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong";
}

export function isTurnstileError(error: unknown) {
  return error instanceof ApiError
    && /human verification/i.test(error.message);
}
