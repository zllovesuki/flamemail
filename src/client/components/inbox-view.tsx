import { useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { EmailDetail } from "@/client/components/email-detail";
import { EmailList } from "@/client/components/email-list";
import { InboxHeader } from "@/client/components/inbox/inbox-header";
import { MissingInboxSessionState } from "@/client/components/inbox/missing-inbox-session-state";
import { ErrorBanner } from "@/client/components/ui";
import { useCountdown } from "@/client/hooks/useCountdown";
import { useInbox } from "@/client/hooks/useInbox";
import { useInboxPageActions } from "@/client/hooks/useInboxPageActions";
import { useInboxRouteSession } from "@/client/hooks/useInboxRouteSession";
import { useWebSocket } from "@/client/hooks/useWebSocket";
import { NewEmailEvent } from "@/shared/contracts";

interface InboxViewProps {
  onDeleted: (address: string) => void;
}

export function InboxView({ onDeleted }: InboxViewProps) {
  const { address, adminMode, session } = useInboxRouteSession();
  const {
    inbox,
    emails,
    selectedEmail,
    selectedEmailId,
    loading,
    emailLoading,
    error,
    refreshInbox,
    refresh,
    selectEmail,
    deleteEmail: removeEmail,
    applyIncomingEmail,
  } = useInbox(session, { markReadOnOpen: !adminMode });

  const countdown = useCountdown(inbox?.expiresAt ?? null);
  const {
    availableExtensions,
    canDeleteEmail,
    extendingTo,
    isAdminInspectingTemporaryInbox,
    handleBackToList,
    handleCopy,
    handleDeleteInbox,
    handleExtendInbox,
  } = useInboxPageActions({
    address,
    adminMode,
    inbox,
    onDeleted,
    refreshInbox,
    selectEmail,
    session,
  });

  const socketState = useWebSocket<NewEmailEvent>({
    address,
    token: session?.token ?? "",
    enabled: Boolean(session),
    messageCodec: NewEmailEvent,
    onMessage: useCallback(
      (message: NewEmailEvent) => {
        if (message.type === "new_email") {
          void applyIncomingEmail(message.email);
        }
      },
      [applyIncomingEmail],
    ),
  });

  if (!session) {
    return <MissingInboxSessionState />;
  }

  return (
    <main className="animate-slide-up space-y-5">
      {/* Inbox hero bar */}
      <InboxHeader
        address={address}
        adminMode={adminMode}
        availableExtensions={availableExtensions}
        countdown={countdown}
        extendingTo={extendingTo}
        inbox={inbox}
        isAdminInspectingTemporaryInbox={isAdminInspectingTemporaryInbox}
        socketState={socketState}
        onCopy={handleCopy}
        onDeleteInbox={handleDeleteInbox}
        onExtendInbox={handleExtendInbox}
        onRefresh={refresh}
      />

      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      {/* Email list + detail — desktop: side-by-side, mobile: toggle */}
      <div className="grid gap-5 lg:grid-cols-[minmax(280px,400px)_minmax(0,1fr)]">
        <div className={selectedEmailId ? "hidden lg:block" : ""}>
          <EmailList
            inboxAddress={address}
            emails={emails}
            selectedEmailId={selectedEmailId}
            loadingEmailId={emailLoading ? selectedEmailId : null}
            loading={loading}
            onSelect={(emailId) => void selectEmail(emailId)}
          />
        </div>
        <div className={selectedEmailId ? "" : "hidden lg:block"}>
          {selectedEmailId ? (
            <button
              type="button"
              className="mb-3 flex items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200 lg:hidden"
              onClick={handleBackToList}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to inbox
            </button>
          ) : null}
          <EmailDetail
            address={address}
            token={session.token}
            email={selectedEmail}
            loading={emailLoading}
            canDelete={canDeleteEmail}
            canViewRaw={adminMode}
            onDelete={(emailId) => void removeEmail(emailId)}
          />
        </div>
      </div>
    </main>
  );
}
