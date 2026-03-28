import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InboxView } from "@/client/components/inbox-view";

const {
  applyIncomingEmailMock,
  deleteEmailMock,
  handleBackToListMock,
  handleCopyMock,
  handleDeleteInboxMock,
  handleExtendInboxMock,
  refreshInboxMock,
  refreshMock,
  selectEmailMock,
  useCountdownMock,
  useInboxMock,
  useInboxPageActionsMock,
  useInboxRouteSessionMock,
  useWebSocketMock,
} = vi.hoisted(() => ({
  applyIncomingEmailMock: vi.fn(),
  deleteEmailMock: vi.fn(),
  handleBackToListMock: vi.fn(),
  handleCopyMock: vi.fn(),
  handleDeleteInboxMock: vi.fn(),
  handleExtendInboxMock: vi.fn(),
  refreshInboxMock: vi.fn(),
  refreshMock: vi.fn(),
  selectEmailMock: vi.fn(),
  useCountdownMock: vi.fn(),
  useInboxMock: vi.fn(),
  useInboxPageActionsMock: vi.fn(),
  useInboxRouteSessionMock: vi.fn(),
  useWebSocketMock: vi.fn(),
}));

vi.mock("@/client/hooks/useCountdown", () => ({
  useCountdown: useCountdownMock,
}));

vi.mock("@/client/hooks/useInbox", () => ({
  useInbox: useInboxMock,
}));

vi.mock("@/client/hooks/useInboxPageActions", () => ({
  useInboxPageActions: useInboxPageActionsMock,
}));

vi.mock("@/client/hooks/useInboxRouteSession", () => ({
  useInboxRouteSession: useInboxRouteSessionMock,
}));

vi.mock("@/client/hooks/useWebSocket", () => ({
  useWebSocket: useWebSocketMock,
}));

vi.mock("@/client/components/inbox/MissingInboxSessionState", () => ({
  MissingInboxSessionState: () => <div>Missing inbox session</div>,
}));

vi.mock("@/client/components/inbox/InboxHeader", () => ({
  InboxHeader: ({
    onCopy,
    onDeleteInbox,
    onExtendInbox,
  }: {
    onCopy: () => void;
    onDeleteInbox: () => void;
    onExtendInbox: (ttlHours: 24 | 48 | 72) => void;
  }) => (
    <div>
      <button type="button" onClick={onCopy}>
        Copy address
      </button>
      <button type="button" onClick={onDeleteInbox}>
        Delete inbox
      </button>
      <button type="button" onClick={() => onExtendInbox(72)}>
        Extend inbox
      </button>
    </div>
  ),
}));

vi.mock("@/client/components/EmailList", () => ({
  EmailList: () => <div>Email list</div>,
}));

vi.mock("@/client/components/EmailDetail", () => ({
  EmailDetail: () => <div>Email detail</div>,
}));

function makeInbox() {
  return {
    address: "reader@mail.test",
    createdAt: "2026-04-15T00:00:00.000Z",
    expiresAt: "2026-04-16T00:00:00.000Z",
    isPermanent: false,
    ttlHours: 24,
  };
}

describe("InboxView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    applyIncomingEmailMock.mockReset();
    deleteEmailMock.mockReset();
    handleBackToListMock.mockReset();
    handleCopyMock.mockReset();
    handleDeleteInboxMock.mockReset();
    handleExtendInboxMock.mockReset();
    refreshInboxMock.mockReset();
    refreshMock.mockReset();
    selectEmailMock.mockReset();
    useCountdownMock.mockReset();
    useInboxMock.mockReset();
    useInboxPageActionsMock.mockReset();
    useInboxRouteSessionMock.mockReset();
    useWebSocketMock.mockReset();

    useCountdownMock.mockReturnValue("23h remaining");
    useInboxRouteSessionMock.mockReturnValue({
      address: "reader@mail.test",
      adminMode: false,
      session: {
        address: "reader@mail.test",
        token: "tok_user",
      },
    });
    useInboxMock.mockReturnValue({
      inbox: makeInbox(),
      emails: [],
      selectedEmail: null,
      selectedEmailId: null,
      loading: false,
      emailLoading: false,
      error: null,
      refreshInbox: refreshInboxMock,
      refresh: refreshMock,
      selectEmail: selectEmailMock,
      deleteEmail: deleteEmailMock,
      applyIncomingEmail: applyIncomingEmailMock,
    });
    useInboxPageActionsMock.mockReturnValue({
      availableExtensions: [48, 72],
      canDeleteEmail: true,
      extendingTo: null,
      isAdminInspectingTemporaryInbox: false,
      handleBackToList: handleBackToListMock,
      handleCopy: handleCopyMock,
      handleDeleteInbox: handleDeleteInboxMock,
      handleExtendInbox: handleExtendInboxMock,
    });
    useWebSocketMock.mockReturnValue("open");
  });

  it("renders the missing-session state without a session", () => {
    useInboxRouteSessionMock.mockReturnValue({
      address: "reader@mail.test",
      adminMode: false,
      session: null,
    });

    render(<InboxView onDeleted={vi.fn()} />);

    expect(screen.getByText("Missing inbox session")).not.toBeNull();
  });

  it("passes copy, delete, and extend handlers through the page actions hook", async () => {
    const onDeleted = vi.fn();
    const user = userEvent.setup();

    render(<InboxView onDeleted={onDeleted} />);

    expect(useInboxPageActionsMock).toHaveBeenCalledWith({
      address: "reader@mail.test",
      adminMode: false,
      inbox: makeInbox(),
      onDeleted,
      refreshInbox: refreshInboxMock,
      selectEmail: selectEmailMock,
      session: {
        address: "reader@mail.test",
        token: "tok_user",
      },
    });

    await user.click(screen.getByRole("button", { name: "Copy address" }));
    await user.click(screen.getByRole("button", { name: "Delete inbox" }));
    await user.click(screen.getByRole("button", { name: "Extend inbox" }));

    expect(handleCopyMock).toHaveBeenCalledTimes(1);
    expect(handleDeleteInboxMock).toHaveBeenCalledTimes(1);
    expect(handleExtendInboxMock).toHaveBeenCalledWith(72);
  });
});
