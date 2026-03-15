import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Clock, Copy, RefreshCw, Timer, Trash2, ShieldAlert } from "lucide-react";
import { EmailDetail } from "@/client/components/EmailDetail";
import { EmailList } from "@/client/components/EmailList";
import { toast } from "@/client/components/Toast";
import { useInbox } from "@/client/hooks/useInbox";
import { useWebSocket } from "@/client/hooks/useWebSocket";
import {
  TEMP_MAILBOX_TTL_HOURS,
  deleteInbox,
  extendInbox,
  getAdminToken,
  getErrorMessage,
  getInboxSession,
  removeInboxSession,
  updateInboxSession,
  type TempMailboxTtlHours,
} from "@/client/lib/api";
import { formatCountdown } from "@/client/lib/time";
import { NewEmailEvent } from "@/shared/contracts";

interface InboxViewProps {
  onDeleted: (address: string) => void;
}

function useCountdown(expiresAt: string | null) {
  const [text, setText] = useState(() => (expiresAt ? formatCountdown(expiresAt) : ""));

  useEffect(() => {
    if (!expiresAt) {
      setText("");
      return;
    }

    setText(formatCountdown(expiresAt));
    const id = window.setInterval(() => setText(formatCountdown(expiresAt)), 30_000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return text;
}

const socketColors: Record<string, string> = {
  open: "bg-emerald-500",
  connecting: "bg-yellow-500 animate-pulse",
  closed: "bg-zinc-500",
  error: "bg-red-500",
  idle: "bg-zinc-600",
};

export function InboxView({ onDeleted }: InboxViewProps) {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const [extendingTo, setExtendingTo] = useState<TempMailboxTtlHours | null>(null);

  const address = useMemo(() => decodeURIComponent(params.address ?? ""), [params.address]);
  const userSession = address ? getInboxSession(address) : null;
  const adminToken = getAdminToken();
  const adminMode = searchParams.get("admin") === "1" || (!userSession && Boolean(adminToken));
  const token = adminMode ? adminToken : (userSession?.token ?? null);

  const session = token && address ? { address, token } : null;
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

  const availableExtensions = useMemo(() => {
    if (!inbox || inbox.isPermanent || !inbox.ttlHours) {
      return [] as TempMailboxTtlHours[];
    }

    const currentTtlHours = inbox.ttlHours;
    return TEMP_MAILBOX_TTL_HOURS.filter((hours) => hours > currentTtlHours);
  }, [inbox]);

  const isAdminInspectingTemporaryInbox = adminMode && inbox !== null && !inbox.isPermanent;
  const canDeleteEmail = !adminMode || inbox?.isPermanent === true;

  const socketState = useWebSocket<NewEmailEvent>({
    address,
    token: token ?? "",
    enabled: Boolean(session),
    messageCodec: NewEmailEvent,
    onMessage: (message) => {
      if (message.type === "new_email") {
        void applyIncomingEmail(message.email);
      }
    },
  });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Address copied to clipboard");
    } catch {
      toast.error("Could not copy the inbox address.");
    }
  };

  const handleDeleteInbox = async () => {
    if (!session || !inbox || inbox.isPermanent) {
      return;
    }

    const confirmed = window.confirm(
      adminMode
        ? `Admin delete ${address} and all stored email? This cannot be undone.`
        : `Delete ${address} and all stored email?`,
    );
    if (!confirmed) {
      return;
    }

    try {
      await deleteInbox(address, session.token);
      removeInboxSession(address);
      onDeleted(address);
      toast.success("Inbox deleted");
      navigate(adminMode ? "/admin" : "/");
    } catch (nextError) {
      toast.error(getErrorMessage(nextError));
    }
  };

  const handleExtendInbox = async (ttlHours: TempMailboxTtlHours) => {
    if (!session || !inbox || inbox.isPermanent) {
      return;
    }

    setExtendingTo(ttlHours);

    try {
      const updated = await extendInbox(address, session.token, ttlHours);
      updateInboxSession(address, {
        expiresAt: updated.expiresAt,
        ttlHours: updated.ttlHours,
      });
      await refreshInbox();
      toast.success(`Inbox extended to ${ttlHours}h`);
    } catch (nextError) {
      toast.error(getErrorMessage(nextError));
    } finally {
      setExtendingTo(null);
    }
  };

  const handleBackToList = () => {
    selectEmail("");
  };

  if (!session) {
    return (
      <main className="animate-slide-up">
        <section className="flex min-h-[320px] items-center justify-center rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <span className="inline-grid h-14 w-14 place-items-center rounded-full bg-zinc-800/60">
              <ShieldAlert className="h-7 w-7 text-zinc-600" />
            </span>
            <div>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Missing Session
              </span>
              <h1 className="text-xl font-semibold text-zinc-200">This inbox is not stored locally</h1>
              <p className="mt-3 max-w-md text-sm text-zinc-500">
                Open it from the device that created it before the inbox expires, or sign in as an admin for permanent
                inboxes.
              </p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="animate-slide-up space-y-5">
      {/* Inbox hero bar */}
      <section className="flex flex-col gap-4 rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-flame-400">Live Inbox</span>
            <span className={`h-1.5 w-1.5 rounded-full ${socketColors[socketState] ?? "bg-zinc-600"}`} />
            <span className="text-xs text-zinc-500">{socketState}</span>
          </div>
          <h1 className="mt-1 truncate text-lg font-semibold text-zinc-100">{address}</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {inbox?.isPermanent ? (
              <span className="text-sm text-zinc-500">Permanent inbox</span>
            ) : countdown ? (
              <span className="flex items-center gap-1.5 text-sm text-zinc-500">
                <Timer className="h-3.5 w-3.5 text-flame-400" />
                {countdown}
              </span>
            ) : (
              <span className="text-sm text-zinc-500">Loading inbox details...</span>
            )}
          </div>
          {isAdminInspectingTemporaryInbox ? (
            <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
              <ShieldAlert className="h-3 w-3" />
              Admin inspection mode: mailbox contents are read-only, but you can delete this temporary inbox.
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700/60"
            type="button"
            onClick={handleCopy}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </button>
          <button
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700/60"
            type="button"
            onClick={() => void refresh()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          {!adminMode &&
            availableExtensions.map((ttlHours) => (
              <button
                key={ttlHours}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                disabled={extendingTo !== null}
                onClick={() => void handleExtendInbox(ttlHours)}
              >
                <Clock className="h-3.5 w-3.5" />
                {extendingTo === ttlHours ? `Extending...` : `Extend ${ttlHours}h`}
              </button>
            ))}
          {inbox && !inbox.isPermanent ? (
            <button
              className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
              type="button"
              onClick={handleDeleteInbox}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {adminMode ? "Delete mailbox" : "Delete"}
            </button>
          ) : null}
        </div>
      </section>

      {error ? (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-400">{error}</p>
      ) : null}

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
