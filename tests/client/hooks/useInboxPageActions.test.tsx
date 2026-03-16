import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInboxPageActions } from "@/client/hooks/useInboxPageActions";
import { clipboardWriteTextMock, confirmMock } from "../../setup/client";

const {
  deleteInboxMock,
  extendInboxMock,
  getErrorMessageMock,
  navigateMock,
  removeInboxSessionMock,
  toastErrorMock,
  toastSuccessMock,
  updateInboxSessionMock,
} = vi.hoisted(() => ({
  deleteInboxMock: vi.fn(),
  extendInboxMock: vi.fn(),
  getErrorMessageMock: vi.fn((error: unknown) => (error instanceof Error ? error.message : "Something went wrong")),
  navigateMock: vi.fn<(path: string) => void>(),
  removeInboxSessionMock: vi.fn(),
  toastErrorMock: vi.fn<(message: string) => void>(),
  toastSuccessMock: vi.fn<(message: string) => void>(),
  updateInboxSessionMock: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/client/components/Toast", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

vi.mock("@/client/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/client/lib/api")>("@/client/lib/api");
  return {
    ...actual,
    deleteInbox: deleteInboxMock,
    extendInbox: extendInboxMock,
    getErrorMessage: getErrorMessageMock,
    removeInboxSession: removeInboxSessionMock,
    updateInboxSession: updateInboxSessionMock,
  };
});

function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <MemoryRouter>{children}</MemoryRouter>;
  };
}

function makeInbox(
  overrides: Partial<{ expiresAt: string; isPermanent: boolean; ttlHours: 24 | 48 | 72 | null }> = {},
) {
  return {
    address: "reader@mail.test",
    createdAt: "2026-04-15T00:00:00.000Z",
    expiresAt: overrides.expiresAt ?? "2026-04-16T00:00:00.000Z",
    isPermanent: overrides.isPermanent ?? false,
    ttlHours: overrides.ttlHours ?? 24,
  };
}

describe("useInboxPageActions", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    deleteInboxMock.mockReset();
    extendInboxMock.mockReset();
    getErrorMessageMock.mockClear();
    removeInboxSessionMock.mockReset();
    updateInboxSessionMock.mockReset();
    confirmMock.mockReset();
    confirmMock.mockReturnValue(true);
    clipboardWriteTextMock.mockReset();
    clipboardWriteTextMock.mockResolvedValue(undefined);
  });

  it("copies the inbox address and shows a success toast", async () => {
    const { result } = renderHook(
      () =>
        useInboxPageActions({
          address: "reader@mail.test",
          adminMode: false,
          inbox: makeInbox(),
          onDeleted: vi.fn(),
          refreshInbox: vi.fn().mockResolvedValue(makeInbox()),
          selectEmail: vi.fn(),
          session: {
            address: "reader@mail.test",
            token: "tok_user",
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.handleCopy();
    });

    expect(clipboardWriteTextMock).toHaveBeenCalledWith("reader@mail.test");
    expect(toastSuccessMock).toHaveBeenCalledWith("Address copied to clipboard");
  });

  it("shows an error toast when copy fails", async () => {
    clipboardWriteTextMock.mockRejectedValueOnce(new Error("copy failed"));
    const { result } = renderHook(
      () =>
        useInboxPageActions({
          address: "reader@mail.test",
          adminMode: false,
          inbox: makeInbox(),
          onDeleted: vi.fn(),
          refreshInbox: vi.fn().mockResolvedValue(makeInbox()),
          selectEmail: vi.fn(),
          session: {
            address: "reader@mail.test",
            token: "tok_user",
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.handleCopy();
    });

    expect(toastErrorMock).toHaveBeenCalledWith("Could not copy the inbox address.");
  });

  it("does nothing when inbox deletion is cancelled", async () => {
    confirmMock.mockReturnValueOnce(false);
    const onDeleted = vi.fn();
    const { result } = renderHook(
      () =>
        useInboxPageActions({
          address: "reader@mail.test",
          adminMode: false,
          inbox: makeInbox(),
          onDeleted,
          refreshInbox: vi.fn().mockResolvedValue(makeInbox()),
          selectEmail: vi.fn(),
          session: {
            address: "reader@mail.test",
            token: "tok_user",
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.handleDeleteInbox();
    });

    expect(deleteInboxMock).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("deletes an inbox, clears session state, notifies, and navigates", async () => {
    deleteInboxMock.mockResolvedValueOnce({ ok: true });
    const onDeleted = vi.fn();
    const { result } = renderHook(
      () =>
        useInboxPageActions({
          address: "reader@mail.test",
          adminMode: false,
          inbox: makeInbox(),
          onDeleted,
          refreshInbox: vi.fn().mockResolvedValue(makeInbox()),
          selectEmail: vi.fn(),
          session: {
            address: "reader@mail.test",
            token: "tok_user",
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.handleDeleteInbox();
    });

    expect(deleteInboxMock).toHaveBeenCalledWith("reader@mail.test", "tok_user");
    expect(removeInboxSessionMock).toHaveBeenCalledWith("reader@mail.test");
    expect(onDeleted).toHaveBeenCalledWith("reader@mail.test");
    expect(toastSuccessMock).toHaveBeenCalledWith("Inbox deleted");
    expect(navigateMock).toHaveBeenCalledWith("/");
  });

  it("surfaces inbox deletion failures", async () => {
    deleteInboxMock.mockRejectedValueOnce(new Error("Delete failed"));
    const { result } = renderHook(
      () =>
        useInboxPageActions({
          address: "reader@mail.test",
          adminMode: false,
          inbox: makeInbox(),
          onDeleted: vi.fn(),
          refreshInbox: vi.fn().mockResolvedValue(makeInbox()),
          selectEmail: vi.fn(),
          session: {
            address: "reader@mail.test",
            token: "tok_user",
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.handleDeleteInbox();
    });

    expect(toastErrorMock).toHaveBeenCalledWith("Delete failed");
  });

  it("extends an inbox, updates local session state, and refreshes the inbox", async () => {
    extendInboxMock.mockResolvedValueOnce({
      address: "reader@mail.test",
      expiresAt: "2026-04-18T00:00:00.000Z",
      ttlHours: 72,
    });
    const refreshInbox = vi.fn().mockResolvedValue(makeInbox({ ttlHours: 72, expiresAt: "2026-04-18T00:00:00.000Z" }));
    const { result } = renderHook(
      () =>
        useInboxPageActions({
          address: "reader@mail.test",
          adminMode: false,
          inbox: makeInbox(),
          onDeleted: vi.fn(),
          refreshInbox,
          selectEmail: vi.fn(),
          session: {
            address: "reader@mail.test",
            token: "tok_user",
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.handleExtendInbox(72);
    });

    expect(extendInboxMock).toHaveBeenCalledWith("reader@mail.test", "tok_user", 72);
    expect(updateInboxSessionMock).toHaveBeenCalledWith("reader@mail.test", {
      expiresAt: "2026-04-18T00:00:00.000Z",
      ttlHours: 72,
    });
    expect(refreshInbox).toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("Inbox extended to 72h");
    await waitFor(() => {
      expect(result.current.extendingTo).toBeNull();
    });
  });

  it("surfaces inbox extension failures", async () => {
    extendInboxMock.mockRejectedValueOnce(new Error("Extend failed"));
    const { result } = renderHook(
      () =>
        useInboxPageActions({
          address: "reader@mail.test",
          adminMode: false,
          inbox: makeInbox(),
          onDeleted: vi.fn(),
          refreshInbox: vi.fn().mockResolvedValue(makeInbox()),
          selectEmail: vi.fn(),
          session: {
            address: "reader@mail.test",
            token: "tok_user",
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.handleExtendInbox(72);
    });

    expect(toastErrorMock).toHaveBeenCalledWith("Extend failed");
    expect(updateInboxSessionMock).not.toHaveBeenCalled();
  });

  it("is a no-op when the session is missing or the inbox is permanent", async () => {
    const { result: missingSession } = renderHook(
      () =>
        useInboxPageActions({
          address: "reader@mail.test",
          adminMode: false,
          inbox: makeInbox(),
          onDeleted: vi.fn(),
          refreshInbox: vi.fn().mockResolvedValue(makeInbox()),
          selectEmail: vi.fn(),
          session: null,
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await missingSession.current.handleDeleteInbox();
      await missingSession.current.handleExtendInbox(72);
    });

    const { result: permanentInbox } = renderHook(
      () =>
        useInboxPageActions({
          address: "admin@mail.test",
          adminMode: true,
          inbox: makeInbox({ isPermanent: true, ttlHours: null, expiresAt: null as never }),
          onDeleted: vi.fn(),
          refreshInbox: vi
            .fn()
            .mockResolvedValue(makeInbox({ isPermanent: true, ttlHours: null, expiresAt: null as never })),
          selectEmail: vi.fn(),
          session: {
            address: "admin@mail.test",
            token: "tok_admin",
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await permanentInbox.current.handleDeleteInbox();
      await permanentInbox.current.handleExtendInbox(72);
    });

    expect(deleteInboxMock).not.toHaveBeenCalled();
    expect(extendInboxMock).not.toHaveBeenCalled();
    expect(permanentInbox.current.availableExtensions).toEqual([]);
    expect(permanentInbox.current.canDeleteEmail).toBe(true);
    expect(missingSession.current.canDeleteEmail).toBe(true);
  });
});
