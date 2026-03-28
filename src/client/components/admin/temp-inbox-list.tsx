import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, Filter, Loader2, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Card, ErrorBanner, PageHeader } from "@/client/components/ui";
import { useAdminSessionGuard } from "@/client/hooks/useAdminSessionGuard";
import { listAdminTempInboxes, type AdminTempInbox } from "@/client/lib/api";
import { fullDate } from "@/client/lib/time";
import { ADMIN_TEMP_INBOX_PAGE_SIZE } from "@/shared/contracts";

interface TempInboxListProps {
  token: string;
  onSessionError: (message?: string) => void;
}

export function TempInboxList({ token, onSessionError }: TempInboxListProps) {
  const [inboxes, setInboxes] = useState<AdminTempInbox[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(ADMIN_TEMP_INBOX_PAGE_SIZE);
  const [hasEmails, setHasEmails] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleAdminError = useAdminSessionGuard(onSessionError);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const results = await listAdminTempInboxes(token, page, hasEmails);
        if (!active) return;
        setInboxes(results.inboxes);
        setTotal(results.total);
        setPageSize(results.pageSize);
      } catch (fetchError) {
        if (!active) return;
        handleAdminError(fetchError, setError);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [handleAdminError, hasEmails, page, token]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handlePageChange = (nextPage: number) => {
    if (nextPage < 0 || nextPage >= totalPages || nextPage === page) return;
    setPage(nextPage);
  };

  const handleToggleFilter = () => {
    setHasEmails((prev) => !prev);
    setPage(0);
  };

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          caption="Temporary Inboxes"
          captionIcon={<Clock className="h-3.5 w-3.5 text-zinc-500" />}
          heading="Currently active mailboxes"
          description="Browse live temporary inboxes, see how many emails they contain, and inspect them in read-only admin mode."
        />
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleToggleFilter}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              hasEmails
                ? "border-accent-500/30 bg-accent-500/10 text-accent-300"
                : "border-zinc-800/60 bg-zinc-900 text-zinc-500 hover:border-zinc-700/60 hover:text-zinc-400"
            }`}
          >
            <Filter className="h-3 w-3" />
            {hasEmails ? "With emails" : "All"}
          </button>
          <span className="whitespace-nowrap rounded-full border border-zinc-800/60 bg-zinc-900 px-3 py-1 text-xs text-zinc-500">
            {total} active mailbox{total !== 1 ? "es" : ""}
          </span>
        </div>
      </div>

      {error ? <ErrorBanner className="mt-5">{error}</ErrorBanner> : null}

      {loading ? (
        <p className="mt-5 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading active temporary inboxes...
        </p>
      ) : null}
      {!loading && !error && inboxes.length === 0 ? (
        <p className="mt-5 text-sm text-zinc-500">
          {hasEmails
            ? "No active temporary inboxes with emails right now."
            : "There are no active temporary inboxes right now."}
        </p>
      ) : null}

      <div className="mt-5 space-y-3">
        {inboxes.map((inbox) => (
          <div key={inbox.address} className="rounded-xl border border-zinc-800/50 bg-zinc-800/30 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <strong className="block truncate text-sm font-semibold text-zinc-200">{inbox.address}</strong>
                <p className="mt-1 text-xs text-zinc-500">
                  Created {fullDate(inbox.createdAt)} · Expires {inbox.expiresAt ? fullDate(inbox.expiresAt) : "never"}
                </p>
                <p className="mt-1 text-xs text-zinc-600">
                  {inbox.domain} · {inbox.ttlHours ? `${inbox.ttlHours}h lifetime` : "temporary"} ·{" "}
                  <span className="font-medium text-zinc-400">
                    {inbox.emailCount} email{inbox.emailCount !== 1 ? "s" : ""}
                  </span>
                </p>
              </div>

              <Link
                to={`/inbox/${encodeURIComponent(inbox.address)}?admin=1`}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-accent-500/20 bg-accent-500/10 px-3 py-1.5 text-xs font-medium text-accent-300 transition-colors hover:bg-accent-500/20"
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
            <Button
              icon={<ChevronLeft className="h-3 w-3" />}
              disabled={page === 0 || loading}
              onClick={() => handlePageChange(page - 1)}
            >
              Previous
            </Button>
            <Button disabled={page >= totalPages - 1 || loading} onClick={() => handlePageChange(page + 1)}>
              Next
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
