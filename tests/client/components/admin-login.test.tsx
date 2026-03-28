import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminLogin } from "@/client/components/admin-login";

const {
  adminLoginMock,
  clearAdminTokenMock,
  getAdminTokenMock,
  getErrorMessageMock,
  isAdminAccessDisabledErrorMock,
  isAdminSessionErrorMock,
  isTurnstileErrorMock,
  listAdminDomainsMock,
  listAdminInboxesMock,
  setAdminTokenMock,
  toastErrorMock,
  toastInfoMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  adminLoginMock: vi.fn(),
  clearAdminTokenMock: vi.fn(),
  getAdminTokenMock: vi.fn<() => string | null>(() => null),
  getErrorMessageMock: vi.fn((error: unknown) => (error instanceof Error ? error.message : "Something went wrong")),
  isAdminAccessDisabledErrorMock: vi.fn(() => false),
  isAdminSessionErrorMock: vi.fn(() => false),
  isTurnstileErrorMock: vi.fn(() => false),
  listAdminDomainsMock: vi.fn(),
  listAdminInboxesMock: vi.fn(),
  setAdminTokenMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/client/components/TurnstileWidget", () => ({
  TurnstileWidget: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) => (
    <button type="button" onClick={() => onTokenChange("turnstile-token")}>
      Complete verification
    </button>
  ),
}));

vi.mock("@/client/components/admin/DomainManager", () => ({
  DomainManager: ({ domains }: { domains: Array<{ domain: string }> }) => (
    <div>Domain manager: {domains.map((domain) => domain.domain).join(",")}</div>
  ),
}));

vi.mock("@/client/components/admin/PermanentInboxList", () => ({
  PermanentInboxList: ({ inboxes }: { inboxes: Array<{ address: string }> }) => (
    <div>Permanent inboxes: {inboxes.map((inbox) => inbox.address).join(",")}</div>
  ),
}));

vi.mock("@/client/components/admin/TempInboxList", () => ({
  TempInboxList: ({ token }: { token: string }) => <div>Temp inbox token: {token}</div>,
}));

vi.mock("@/client/components/Toast", () => ({
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
    adminLogin: adminLoginMock,
    clearAdminToken: clearAdminTokenMock,
    getAdminToken: getAdminTokenMock,
    getErrorMessage: getErrorMessageMock,
    isAdminAccessDisabledError: isAdminAccessDisabledErrorMock,
    isAdminSessionError: isAdminSessionErrorMock,
    isTurnstileError: isTurnstileErrorMock,
    listAdminDomains: listAdminDomainsMock,
    listAdminInboxes: listAdminInboxesMock,
    setAdminToken: setAdminTokenMock,
  };
});

describe("AdminLogin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    adminLoginMock.mockReset();
    clearAdminTokenMock.mockReset();
    getAdminTokenMock.mockReset();
    getAdminTokenMock.mockReturnValue(null);
    getErrorMessageMock.mockClear();
    getErrorMessageMock.mockImplementation((error: unknown) =>
      error instanceof Error ? error.message : "Something went wrong",
    );
    isAdminAccessDisabledErrorMock.mockReset();
    isAdminAccessDisabledErrorMock.mockReturnValue(false);
    isAdminSessionErrorMock.mockReset();
    isAdminSessionErrorMock.mockReturnValue(false);
    isTurnstileErrorMock.mockReset();
    isTurnstileErrorMock.mockReturnValue(false);
    listAdminDomainsMock.mockReset();
    listAdminInboxesMock.mockReset();
    setAdminTokenMock.mockReset();
    toastErrorMock.mockReset();
    toastInfoMock.mockReset();
    toastSuccessMock.mockReset();
  });

  it("shows the login error when sign in fails", async () => {
    adminLoginMock.mockRejectedValueOnce(new Error("Invalid admin password"));
    const user = userEvent.setup();

    render(<AdminLogin />);

    await user.type(screen.getByPlaceholderText("Enter ADMIN_PASSWORD"), "bad-password");
    await user.click(screen.getByRole("button", { name: "Complete verification" }));
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(adminLoginMock).toHaveBeenCalledWith("bad-password", "turnstile-token");
    });
    expect(toastErrorMock).toHaveBeenCalledWith("Invalid admin password");
  });

  it("shows the authenticated view after a successful login", async () => {
    adminLoginMock.mockResolvedValueOnce({ token: "tok_admin" });
    listAdminDomainsMock.mockResolvedValueOnce([
      {
        canDelete: true,
        createdAt: "2026-04-15T00:00:00.000Z",
        domain: "mail.test",
        inboxCount: 4,
        isActive: true,
      },
    ]);
    listAdminInboxesMock.mockResolvedValueOnce([
      {
        address: "admin@mail.test",
        domain: "mail.test",
        emailCount: 2,
        localPart: "admin",
      },
    ]);
    const user = userEvent.setup();

    render(<AdminLogin />);

    await user.type(screen.getByPlaceholderText("Enter ADMIN_PASSWORD"), "correct-password");
    await user.click(screen.getByRole("button", { name: "Complete verification" }));
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(setAdminTokenMock).toHaveBeenCalledWith("tok_admin");
    });
    await waitFor(() => {
      expect(listAdminDomainsMock).toHaveBeenCalledWith("tok_admin");
      expect(listAdminInboxesMock).toHaveBeenCalledWith("tok_admin");
    });

    expect(screen.getByText("Authenticated")).not.toBeNull();
    expect(screen.getByText("Domain manager: mail.test")).not.toBeNull();
    expect(screen.getByText("Permanent inboxes: admin@mail.test")).not.toBeNull();
    expect(screen.getByText("Temp inbox token: tok_admin")).not.toBeNull();
    expect(toastSuccessMock).toHaveBeenCalledWith("Admin session started");
  });

  it("resets state when an existing admin session fails authentication", async () => {
    getAdminTokenMock.mockReturnValue("tok_admin");
    listAdminDomainsMock.mockRejectedValueOnce(new Error("Session expired"));
    isAdminSessionErrorMock.mockReturnValue(true);

    render(<AdminLogin />);

    await waitFor(() => {
      expect(listAdminDomainsMock).toHaveBeenCalledWith("tok_admin");
    });
    await waitFor(() => {
      expect(clearAdminTokenMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole("button", { name: /sign in/i })).not.toBeNull();
    expect(screen.queryByText("Authenticated")).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith("Session expired");
  });
});
