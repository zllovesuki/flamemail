import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminLogin } from "@/client/components/admin-login";
import { ApiError } from "@/client/lib/api";

const {
  adminLogoutMock,
  clearAdminBookmarkMock,
  listAdminDomainsMock,
  listAdminInboxesMock,
  toastErrorMock,
  toastInfoMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  adminLogoutMock: vi.fn(),
  clearAdminBookmarkMock: vi.fn(),
  listAdminDomainsMock: vi.fn(),
  listAdminInboxesMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/client/components/admin/domain-manager", () => ({
  DomainManager: ({ domains, onReload }: { domains: Array<{ domain: string }>; onReload: () => Promise<void> }) => {
    const handleReload = async () => {
      try {
        await onReload();
        toastSuccessMock("reload succeeded");
      } catch (error) {
        toastErrorMock(error instanceof Error ? error.message : "reload failed");
      }
    };

    return (
      <div>
        <div>Domain manager: {domains.map((domain) => domain.domain).join(",")}</div>
        <button type="button" onClick={() => void handleReload()}>
          Reload admin data
        </button>
      </div>
    );
  },
}));

vi.mock("@/client/components/admin/permanent-inbox-list", () => ({
  PermanentInboxList: ({ inboxes }: { inboxes: Array<{ address: string }> }) => (
    <div>Permanent inboxes: {inboxes.map((inbox) => inbox.address).join(",")}</div>
  ),
}));

vi.mock("@/client/components/admin/temp-inbox-list", () => ({
  TempInboxList: () => <div>Temp inbox list</div>,
}));

vi.mock("@/client/components/toast", () => ({
  toast: {
    error: toastErrorMock,
    info: toastInfoMock,
    success: toastSuccessMock,
  },
}));

vi.mock("@/client/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/client/lib/api")>("@/client/lib/api");
  return {
    ...actual,
    adminLogout: adminLogoutMock,
    clearAdminBookmark: clearAdminBookmarkMock,
    listAdminDomains: listAdminDomainsMock,
    listAdminInboxes: listAdminInboxesMock,
  };
});

function renderAdmin(initialEntries: string[] = ["/admin"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AdminLogin />
    </MemoryRouter>,
  );
}

describe("AdminLogin", () => {
  beforeEach(() => {
    adminLogoutMock.mockReset();
    clearAdminBookmarkMock.mockReset();
    listAdminDomainsMock.mockReset();
    listAdminInboxesMock.mockReset();
    toastErrorMock.mockReset();
    toastInfoMock.mockReset();
    toastSuccessMock.mockReset();
  });

  it("renders the sign-in card when the cookie session is missing", async () => {
    listAdminDomainsMock.mockRejectedValue(new ApiError("Unauthorized", 401));
    listAdminInboxesMock.mockRejectedValue(new ApiError("Unauthorized", 401));

    renderAdmin();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /sign in with tessera/i }).getAttribute("href")).toBe(
        "/api/public/admin/start",
      );
    });
    expect(screen.queryByText(/Authenticated via tessera/)).toBeNull();
  });

  it("renders the authenticated console when admin data loads", async () => {
    listAdminDomainsMock.mockResolvedValue([
      {
        canDelete: true,
        createdAt: "2026-04-15T00:00:00.000Z",
        domain: "mail.test",
        inboxCount: 4,
        isActive: true,
      },
    ]);
    listAdminInboxesMock.mockResolvedValue([
      {
        address: "admin@mail.test",
        domain: "mail.test",
        emailCount: 2,
        localPart: "admin",
      },
    ]);

    renderAdmin();

    await waitFor(() => {
      expect(screen.getByText("Authenticated via tessera")).not.toBeNull();
    });
    expect(screen.getByText("Domain manager: mail.test")).not.toBeNull();
    expect(screen.getByText("Permanent inboxes: admin@mail.test")).not.toBeNull();
    expect(screen.getByText("Temp inbox list")).not.toBeNull();
  });

  it("surfaces the ?error= banner copy", async () => {
    listAdminDomainsMock.mockRejectedValue(new ApiError("Unauthorized", 401));
    listAdminInboxesMock.mockRejectedValue(new ApiError("Unauthorized", 401));

    renderAdmin(["/admin?error=not_operator"]);

    await waitFor(() => {
      expect(screen.getByText(/not authorized for admin access/i)).not.toBeNull();
    });
  });

  it("logs out via the public logout endpoint and re-renders the sign-in card", async () => {
    listAdminDomainsMock.mockResolvedValueOnce([]);
    listAdminInboxesMock.mockResolvedValueOnce([]);
    adminLogoutMock.mockResolvedValueOnce({ ok: true });

    renderAdmin();

    await waitFor(() => {
      expect(screen.getByText("Authenticated via tessera")).not.toBeNull();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => {
      expect(adminLogoutMock).toHaveBeenCalledTimes(1);
    });
    expect(clearAdminBookmarkMock).toHaveBeenCalledTimes(1);
    expect(toastInfoMock).toHaveBeenCalledWith("Admin session cleared");
    expect(screen.getByRole("link", { name: /sign in with tessera/i })).not.toBeNull();
  });

  it("keeps the authenticated view when logout fails", async () => {
    listAdminDomainsMock.mockResolvedValueOnce([]);
    listAdminInboxesMock.mockResolvedValueOnce([]);
    adminLogoutMock.mockRejectedValueOnce(new Error("logout failed"));

    renderAdmin();

    await waitFor(() => {
      expect(screen.getByText("Authenticated via tessera")).not.toBeNull();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("logout failed");
    });
    expect(clearAdminBookmarkMock).not.toHaveBeenCalled();
    expect(toastInfoMock).not.toHaveBeenCalledWith("Admin session cleared");
    expect(screen.getByText("Authenticated via tessera")).not.toBeNull();
    expect(screen.queryByRole("link", { name: /sign in with tessera/i })).toBeNull();
  });

  it("propagates reload failures to child mutation handlers", async () => {
    listAdminDomainsMock.mockResolvedValueOnce([
      {
        canDelete: true,
        createdAt: "2026-04-15T00:00:00.000Z",
        domain: "mail.test",
        inboxCount: 4,
        isActive: true,
      },
    ]);
    listAdminInboxesMock.mockResolvedValueOnce([]);

    renderAdmin();

    await waitFor(() => {
      expect(screen.getByText("Authenticated via tessera")).not.toBeNull();
    });

    listAdminDomainsMock.mockRejectedValueOnce(new Error("reload failed"));
    listAdminInboxesMock.mockResolvedValueOnce([]);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /reload admin data/i }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("reload failed");
    });
    expect(toastSuccessMock).not.toHaveBeenCalledWith("reload succeeded");
  });
});
