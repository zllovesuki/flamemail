import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateInbox } from "@/client/components/create-inbox";

const { createInboxMock, getErrorMessageMock, isTurnstileErrorMock, listDomainsMock } = vi.hoisted(() => ({
  createInboxMock: vi.fn(),
  getErrorMessageMock: vi.fn((error: unknown) => (error instanceof Error ? error.message : "Something went wrong")),
  isTurnstileErrorMock: vi.fn(() => false),
  listDomainsMock: vi.fn(),
}));

vi.mock("@/client/components/TurnstileWidget", () => ({
  TurnstileWidget: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) => (
    <button type="button" onClick={() => onTokenChange("turnstile-token")}>
      Complete verification
    </button>
  ),
}));

vi.mock("@/client/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/client/lib/api")>("@/client/lib/api");
  return {
    ...actual,
    createInbox: createInboxMock,
    getErrorMessage: getErrorMessageMock,
    isTurnstileError: isTurnstileErrorMock,
    listDomains: listDomainsMock,
  };
});

describe("CreateInbox", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    listDomainsMock.mockReset();
    createInboxMock.mockReset();
    getErrorMessageMock.mockClear();
    isTurnstileErrorMock.mockReset();
    isTurnstileErrorMock.mockReturnValue(false);
  });

  it("loads available domains", async () => {
    listDomainsMock.mockResolvedValueOnce(["mail.test", "alpha.test"]);

    render(<CreateInbox onCreated={vi.fn()} />);

    expect(screen.getByText("Loading available domains...")).not.toBeNull();

    await waitFor(() => {
      expect(listDomainsMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText("mail.test")).not.toBeNull();
    expect(screen.getByText("alpha.test")).not.toBeNull();
  });

  it("shows the empty-domain state", async () => {
    listDomainsMock.mockResolvedValueOnce([]);

    render(<CreateInbox onCreated={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("No domains available yet. An admin needs to add one first.")).not.toBeNull();
    });

    expect(screen.getByRole("button", { name: /create inbox/i }).hasAttribute("disabled")).toBe(true);
  });

  it("requires a turnstile token before submit", async () => {
    listDomainsMock.mockResolvedValueOnce(["mail.test"]);
    const onCreated = vi.fn();
    const { container } = render(<CreateInbox onCreated={onCreated} />);

    await waitFor(() => {
      expect(listDomainsMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("mail.test")).not.toBeNull();

    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    fireEvent.submit(form as HTMLFormElement);

    expect(await screen.findByText("Complete human verification to continue.")).not.toBeNull();
    expect(createInboxMock).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("creates an inbox after verification", async () => {
    listDomainsMock.mockResolvedValueOnce(["mail.test"]);
    createInboxMock.mockResolvedValueOnce({
      address: "reader@mail.test",
      expiresAt: "2026-04-16T00:00:00.000Z",
      token: "tok_user",
      ttlHours: 24,
    });
    const onCreated = vi.fn();
    const user = userEvent.setup();

    render(<CreateInbox onCreated={onCreated} />);

    await waitFor(() => {
      expect(listDomainsMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("mail.test")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Complete verification" }));
    await user.click(screen.getByRole("button", { name: /create inbox/i }));

    await waitFor(() => {
      expect(createInboxMock).toHaveBeenCalledWith("mail.test", 24, "turnstile-token");
    });
    expect(onCreated).toHaveBeenCalledWith({
      address: "reader@mail.test",
      expiresAt: "2026-04-16T00:00:00.000Z",
      token: "tok_user",
      ttlHours: 24,
    });
  });
});
