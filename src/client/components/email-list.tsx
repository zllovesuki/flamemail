import { Loader2, Mail, Paperclip } from "lucide-react";
import { Badge } from "@/client/components/ui";
import type { EmailSummary } from "@/client/lib/api";
import { fullDate, relativeTime } from "@/client/lib/time";

interface EmailListProps {
  inboxAddress: string;
  emails: EmailSummary[];
  selectedEmailId: string | null;
  loadingEmailId: string | null;
  loading: boolean;
  onSelect: (emailId: string) => void;
}

export function EmailList({
  inboxAddress,
  emails,
  selectedEmailId,
  loadingEmailId,
  loading,
  onSelect,
}: EmailListProps) {
  return (
    <aside className="flex max-h-[calc(100vh-220px)] min-h-[560px] flex-col rounded-2xl border border-zinc-800/60 bg-zinc-900/50">
      <div className="flex items-start justify-between gap-3 p-5 pb-0">
        <div>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">Messages</span>
          <h2 className="text-base font-semibold text-zinc-100">Inbox timeline</h2>
        </div>
        <Badge variant="accent">{emails.length}</Badge>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 px-5 pt-4 text-sm text-zinc-500" aria-busy="true">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Refreshing inbox...
        </div>
      ) : null}

      {!loading && emails.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <span className="inline-grid h-12 w-12 place-items-center rounded-full bg-zinc-800/60">
            <Mail className="h-6 w-6 text-zinc-600" />
          </span>
          <p className="text-sm text-zinc-500">No emails have arrived yet.</p>
          <p className="text-xs text-zinc-600">New messages will appear here automatically.</p>
        </div>
      ) : null}

      <div className="mt-3 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
        {emails.map((email, i) => {
          const active = email.id === selectedEmailId;
          const unread = !email.isRead;
          const showRecipientAddress = email.recipientAddress && email.recipientAddress !== inboxAddress;

          return (
            <button
              key={email.id}
              type="button"
              className={`animate-scale-fade opacity-0 group relative w-full rounded-xl border px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
                active
                  ? "border-accent-500/30 bg-accent-500/5"
                  : "border-transparent bg-zinc-800/20 hover:border-zinc-700/60 hover:bg-zinc-800/40"
              }`}
              style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
              onClick={() => onSelect(email.id)}
            >
              {unread ? (
                <span className="absolute left-1.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-accent-500" />
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <strong
                  className={`truncate text-sm ${unread ? "font-semibold text-zinc-100" : "font-medium text-zinc-300"}`}
                >
                  {email.fromName || email.fromAddress}
                </strong>
                {loadingEmailId === email.id ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent-400" />
                ) : (
                  <span className="shrink-0 text-xs text-zinc-500" title={fullDate(email.receivedAt)}>
                    {relativeTime(email.receivedAt)}
                  </span>
                )}
              </div>
              <div className={`mt-0.5 truncate text-sm ${unread ? "text-zinc-200" : "text-zinc-400"}`}>
                {email.subject}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span className="truncate">{email.fromAddress}</span>
                {showRecipientAddress ? (
                  <span className="inline-flex items-center rounded-full border border-zinc-700/70 bg-zinc-800 px-2 py-0.5 text-zinc-400">
                    Delivered to {email.recipientAddress}
                  </span>
                ) : null}
                {email.hasAttachments ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-400">
                    <Paperclip className="h-3 w-3" />
                    <span className="hidden sm:inline">Files</span>
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
