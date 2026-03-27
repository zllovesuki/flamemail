import { Clock, Copy, RefreshCw, Timer, Trash2, ShieldAlert } from "lucide-react";
import { Button } from "@/client/components/ui";
import type { InboxInfo, TempMailboxTtlHours } from "@/client/lib/api";

const socketColors: Record<string, string> = {
  open: "bg-emerald-500",
  connecting: "bg-yellow-500 animate-pulse",
  closed: "bg-zinc-500",
  error: "bg-red-500",
  idle: "bg-zinc-600",
};

interface InboxHeaderProps {
  address: string;
  adminMode: boolean;
  availableExtensions: TempMailboxTtlHours[];
  countdown: string;
  extendingTo: TempMailboxTtlHours | null;
  inbox: InboxInfo | null;
  isAdminInspectingTemporaryInbox: boolean;
  socketState: "idle" | "connecting" | "open" | "closed" | "error";
  onCopy: () => void | Promise<void>;
  onDeleteInbox: () => void | Promise<void>;
  onExtendInbox: (ttlHours: TempMailboxTtlHours) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}

export function InboxHeader({
  address,
  adminMode,
  availableExtensions,
  countdown,
  extendingTo,
  inbox,
  isAdminInspectingTemporaryInbox,
  socketState,
  onCopy,
  onDeleteInbox,
  onExtendInbox,
  onRefresh,
}: InboxHeaderProps) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-accent-400">Live Inbox</span>
          <span className={`h-1.5 w-1.5 rounded-full ${socketColors[socketState] ?? "bg-zinc-600"}`} />
          <span className="text-xs text-zinc-500">{socketState}</span>
        </div>
        <h1 className="mt-1 truncate text-lg font-semibold text-zinc-100">{address}</h1>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {inbox?.isPermanent ? (
            <span className="text-sm text-zinc-500">Permanent inbox</span>
          ) : countdown ? (
            <span className="flex items-center gap-1.5 text-sm text-zinc-500">
              <Timer className="h-3.5 w-3.5 text-accent-400" />
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
        <Button icon={<Copy className="h-3.5 w-3.5" />} onClick={() => void onCopy()}>
          Copy
        </Button>
        <Button icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void onRefresh()}>
          Refresh
        </Button>
        {!adminMode &&
          availableExtensions.map((ttlHours) => (
            <button
              key={ttlHours}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-transform hover:bg-emerald-500/20 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
              type="button"
              disabled={extendingTo !== null}
              onClick={() => void onExtendInbox(ttlHours)}
            >
              <Clock className="h-3.5 w-3.5" />
              {extendingTo === ttlHours ? "Extending..." : `Extend ${ttlHours}h`}
            </button>
          ))}
        {inbox && !inbox.isPermanent ? (
          <Button variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void onDeleteInbox()}>
            {adminMode ? "Delete mailbox" : "Delete"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
