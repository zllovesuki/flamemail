import { ChevronLeft, ChevronRight, Clock, Loader2, Search } from "lucide-react";
import { Link } from "react-router-dom";
import type { AdminTempInbox } from "@/client/lib/api";

interface TempInboxListProps {
  inboxes: AdminTempInbox[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export function TempInboxList({ inboxes, total, page, pageSize, loading, onPageChange }: TempInboxListProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-zinc-500" />
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Temporary Inboxes</span>
          </div>
          <h2 className="text-lg font-semibold text-zinc-100">Currently active mailboxes</h2>
          <p className="mt-2 text-sm text-zinc-500">
            Browse live temporary inboxes, see how many emails they contain, and inspect them in read-only admin mode.
          </p>
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-full border border-zinc-800/60 bg-zinc-900 px-3 py-1 text-xs text-zinc-500">
          {total} active mailbox{total !== 1 ? "es" : ""}
        </span>
      </div>

      {loading ? (
        <p className="mt-5 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading active temporary inboxes...
        </p>
      ) : null}
      {!loading && inboxes.length === 0 ? (
        <p className="mt-5 text-sm text-zinc-500">There are no active temporary inboxes right now.</p>
      ) : null}

      <div className="mt-5 space-y-3">
        {inboxes.map((inbox) => (
          <div key={inbox.address} className="rounded-xl border border-zinc-800/50 bg-zinc-800/30 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <strong className="block truncate text-sm font-semibold text-zinc-200">{inbox.address}</strong>
                <p className="mt-1 text-xs text-zinc-500">
                  Created {formatDate(inbox.createdAt)} · Expires {inbox.expiresAt ? formatDate(inbox.expiresAt) : "never"}
                </p>
                <p className="mt-1 text-xs text-zinc-600">
                  {inbox.domain} · {inbox.ttlHours ? `${inbox.ttlHours}h lifetime` : "temporary"} · {inbox.emailCount} email{inbox.emailCount !== 1 ? "s" : ""}
                </p>
              </div>

              <Link
                to={`/inbox/${encodeURIComponent(inbox.address)}?admin=1`}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-flame-500/20 bg-flame-500/10 px-3 py-1.5 text-xs font-medium text-flame-300 transition-colors hover:bg-flame-500/20"
              >
                <Search className="h-3 w-3" />
                Inspect mailbox
              </Link>
            </div>
          </div>
        ))}
      </div>

      {total > pageSize ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800/60 pt-4 text-sm text-zinc-500">
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 0 || loading}
              onClick={() => onPageChange(page - 1)}
              className="flex items-center gap-1 rounded-lg border border-zinc-700/60 bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft className="h-3 w-3" />
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1 || loading}
              onClick={() => onPageChange(page + 1)}
              className="flex items-center gap-1 rounded-lg border border-zinc-700/60 bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
