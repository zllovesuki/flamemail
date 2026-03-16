import {
  InboxSession,
  InboxSessionSummary,
  InboxSessionSummaryList,
  type InboxSession as InboxSessionType,
  type InboxSessionSummary as InboxSessionSummaryType,
} from "@/shared/contracts";
import { ADMIN_BOOKMARK_SCOPE, ADMIN_TOKEN_KEY, INBOX_SESSIONS_KEY, INBOX_TOKEN_KEY_PREFIX } from "./shared";
import { clearStoredBookmark, getInboxBookmarkScope } from "./bookmarks";

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
  const next = writeStoredSessions(
    [summary, ...pruneExpiredSessions().filter((item) => item.address !== session.address)].slice(0, 8),
  );

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
