import { describe, expect, it } from "vitest";
import { setStoredBookmark, getStoredBookmark } from "@/client/lib/api/bookmarks";
import {
  clearAdminToken,
  getAdminToken,
  getInboxSession,
  loadInboxSessions,
  removeInboxSession,
  setAdminToken,
  storeInboxSession,
  updateInboxSession,
} from "@/client/lib/api/session-storage";
import { ADMIN_BOOKMARK_SCOPE, INBOX_SESSIONS_KEY, INBOX_TOKEN_KEY_PREFIX } from "@/client/lib/api/shared";

function makeSession(
  index: number,
  overrides: Partial<{ address: string; expiresAt: string; token: string; ttlHours: 24 | 48 | 72 }> = {},
) {
  return {
    address: overrides.address ?? `user${index}@mail.test`,
    expiresAt: overrides.expiresAt ?? `2099-01-${String((index % 9) + 1).padStart(2, "0")}T00:00:00.000Z`,
    token: overrides.token ?? `tok_${index}`,
    ttlHours: overrides.ttlHours ?? 24,
  };
}

describe("client inbox session storage", () => {
  it("stores a new inbox session and returns it on lookup", () => {
    const session = makeSession(1);

    const stored = storeInboxSession(session);

    expect(stored).toEqual([
      {
        address: session.address,
        expiresAt: session.expiresAt,
        ttlHours: session.ttlHours,
      },
    ]);
    expect(getInboxSession(session.address)).toEqual(session);
  });

  it("keeps only the most recent inbox sessions", () => {
    for (let index = 0; index < 10; index += 1) {
      storeInboxSession(makeSession(index));
    }

    const sessions = loadInboxSessions();

    expect(sessions).toHaveLength(8);
    expect(sessions[0]?.address).toBe("user9@mail.test");
    expect(sessions[7]?.address).toBe("user2@mail.test");
    expect(sessions.some((session) => session.address === "user1@mail.test")).toBe(false);
    expect(getInboxSession("user1@mail.test")).toBeNull();
  });

  it("prunes expired sessions and removes their tokens and bookmarks on read", () => {
    const expired = makeSession(1, {
      address: "expired@mail.test",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    const active = makeSession(2, {
      address: "active@mail.test",
    });

    storeInboxSession(expired);
    setStoredBookmark("inbox:expired@mail.test", "bookmark-expired");
    storeInboxSession(active);
    setStoredBookmark("inbox:active@mail.test", "bookmark-active");

    const sessions = loadInboxSessions();

    expect(sessions).toEqual([
      {
        address: active.address,
        expiresAt: active.expiresAt,
        ttlHours: active.ttlHours,
      },
    ]);
    expect(localStorage.getItem(`${INBOX_TOKEN_KEY_PREFIX}:expired@mail.test`)).toBeNull();
    expect(getStoredBookmark("inbox:expired@mail.test")).toBeNull();
    expect(getStoredBookmark("inbox:active@mail.test")).toBe("bookmark-active");
  });

  it("migrates legacy sessionStorage inbox tokens into localStorage", () => {
    const session = makeSession(1, {
      address: "legacy@mail.test",
    });
    localStorage.setItem(
      INBOX_SESSIONS_KEY,
      JSON.stringify([
        {
          address: session.address,
          expiresAt: session.expiresAt,
          ttlHours: session.ttlHours,
        },
      ]),
    );
    sessionStorage.setItem(`${INBOX_TOKEN_KEY_PREFIX}:${session.address}`, session.token);

    const restored = getInboxSession(session.address);

    expect(restored).toEqual(session);
    expect(localStorage.getItem(`${INBOX_TOKEN_KEY_PREFIX}:${session.address}`)).toBe(session.token);
    expect(sessionStorage.getItem(`${INBOX_TOKEN_KEY_PREFIX}:${session.address}`)).toBeNull();
  });

  it("returns null when a summary exists but the token is missing", () => {
    const session = makeSession(1, {
      address: "missing-token@mail.test",
    });
    localStorage.setItem(
      INBOX_SESSIONS_KEY,
      JSON.stringify([
        {
          address: session.address,
          expiresAt: session.expiresAt,
          ttlHours: session.ttlHours,
        },
      ]),
    );

    expect(getInboxSession(session.address)).toBeNull();
  });

  it("updates ttl, expiry, and token on session update", () => {
    const session = makeSession(1, {
      address: "reader@mail.test",
      ttlHours: 24,
    });
    storeInboxSession(session);

    const updated = updateInboxSession(session.address, {
      expiresAt: "2099-02-01T00:00:00.000Z",
      ttlHours: 72,
      token: "tok_updated",
    });

    expect(updated).toEqual([
      {
        address: session.address,
        expiresAt: "2099-02-01T00:00:00.000Z",
        ttlHours: 72,
      },
    ]);
    expect(getInboxSession(session.address)).toEqual({
      address: session.address,
      expiresAt: "2099-02-01T00:00:00.000Z",
      token: "tok_updated",
      ttlHours: 72,
    });
  });

  it("removes inbox sessions and clears related token and bookmark state", () => {
    const session = makeSession(1, {
      address: "reader@mail.test",
    });
    storeInboxSession(session);
    setStoredBookmark("inbox:reader@mail.test", "bookmark-reader");

    const remaining = removeInboxSession(session.address);

    expect(remaining).toEqual([]);
    expect(localStorage.getItem(`${INBOX_TOKEN_KEY_PREFIX}:${session.address}`)).toBeNull();
    expect(getStoredBookmark("inbox:reader@mail.test")).toBeNull();
  });

  it("removes expired sessions when an update makes them expire immediately", () => {
    const session = makeSession(1, {
      address: "reader@mail.test",
    });
    storeInboxSession(session);

    const remaining = updateInboxSession(session.address, {
      expiresAt: "2020-01-01T00:00:00.000Z",
    });

    expect(remaining).toEqual([]);
    expect(getInboxSession(session.address)).toBeNull();
  });

  it("clears the admin token and admin bookmark scope", () => {
    setAdminToken("tok_admin");
    setStoredBookmark(ADMIN_BOOKMARK_SCOPE, "bookmark-admin");

    clearAdminToken();

    expect(getAdminToken()).toBeNull();
    expect(getStoredBookmark(ADMIN_BOOKMARK_SCOPE)).toBeNull();
  });
});
