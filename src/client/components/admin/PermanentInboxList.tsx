import { Loader2, Mail } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, PageHeader } from "@/client/components/ui";
import type { AdminInbox } from "@/client/lib/api";

interface PermanentInboxListProps {
  inboxes: AdminInbox[];
  loading: boolean;
}

export function PermanentInboxList({ inboxes, loading }: PermanentInboxListProps) {
  return (
    <Card>
      <PageHeader
        caption="Permanent Inboxes"
        captionIcon={<Mail className="h-3.5 w-3.5 text-zinc-500" />}
        heading="Available addresses"
      />

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading permanent inboxes...
        </p>
      ) : null}
      {!loading && inboxes.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">
          No permanent inboxes yet. They are created automatically when a domain is added.
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {inboxes.map((inbox) => (
          <Link
            key={inbox.address}
            className="group rounded-xl border border-zinc-800/50 bg-zinc-800/30 p-4 hover:border-zinc-700/60 hover:bg-zinc-800/60 hover:-translate-y-0.5 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            to={`/inbox/${encodeURIComponent(inbox.address)}?admin=1`}
          >
            <span className="flex items-center justify-between">
              <strong className="text-sm font-semibold text-zinc-200 group-hover:text-accent-400">
                {inbox.localPart}
              </strong>
              <span className="rounded-full bg-zinc-700/60 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-300">
                {inbox.emailCount} email{inbox.emailCount !== 1 ? "s" : ""}
              </span>
            </span>
            <span className="mt-0.5 block text-xs text-zinc-500">{inbox.domain}</span>
            <small className="mt-1 block truncate font-mono text-xs text-zinc-600">{inbox.address}</small>
          </Link>
        ))}
      </div>
    </Card>
  );
}
