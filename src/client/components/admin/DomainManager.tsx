import { useState } from "react";
import { Globe, Loader2, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { toast } from "@/client/components/Toast";
import { useAdminSessionGuard } from "@/client/hooks/useAdminSessionGuard";
import { addAdminDomain, deleteAdminDomain, updateAdminDomain, type AdminDomain } from "@/client/lib/api";
import { fullDate } from "@/client/lib/time";

interface DomainManagerProps {
  token: string;
  domains: AdminDomain[];
  loading: boolean;
  onAdminSessionError: (message?: string) => void;
  onReload: () => Promise<void>;
}

export function DomainManager({ token, domains, loading, onAdminSessionError, onReload }: DomainManagerProps) {
  const [newDomain, setNewDomain] = useState("");
  const [newDomainActive, setNewDomainActive] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const handleAdminError = useAdminSessionGuard(onAdminSessionError);

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("add");

    try {
      await addAdminDomain(token, newDomain, newDomainActive);
      setNewDomain("");
      setNewDomainActive(true);
      await onReload();
      toast.success(`Domain ${newDomain} added`);
    } catch (error) {
      handleAdminError(error, toast.error);
    } finally {
      setBusy(null);
    }
  };

  const handleToggle = async (domain: AdminDomain) => {
    setBusy(domain.domain);

    try {
      await updateAdminDomain(token, domain.domain, !domain.isActive);
      await onReload();
      toast.success(`${domain.domain} ${domain.isActive ? "disabled" : "enabled"}`);
    } catch (error) {
      handleAdminError(error, toast.error);
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (domain: AdminDomain) => {
    if (!domain.canDelete) {
      return;
    }

    const confirmed = window.confirm(`Delete ${domain.domain} from the domain pool?`);
    if (!confirmed) {
      return;
    }

    setBusy(domain.domain);

    try {
      await deleteAdminDomain(token, domain.domain);
      await onReload();
      toast.success(`${domain.domain} deleted`);
    } catch (error) {
      handleAdminError(error, toast.error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-zinc-500" />
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Domain Pool</span>
          </div>
          <h2 className="text-lg font-semibold text-zinc-100">Manage inbound domains</h2>
          <p className="mt-2 text-sm text-zinc-500">
            Active domains are available for public inbox creation. Disabled domains no longer accept new temporary
            inboxes or inbound mail.
          </p>
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-full border border-zinc-800/60 bg-zinc-900 px-3 py-1 text-xs text-zinc-500">
          {domains.length} domain{domains.length !== 1 ? "s" : ""}
        </span>
      </div>

      <form className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]" onSubmit={handleAdd}>
        <input
          type="text"
          value={newDomain}
          onChange={(event) => setNewDomain(event.target.value)}
          placeholder="example.com"
          disabled={busy === "add"}
          className="w-full rounded-xl border border-zinc-700/60 bg-zinc-800/80 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-flame-500/50 focus:ring-1 focus:ring-flame-500/30 disabled:opacity-50"
        />

        <label className="flex items-center gap-2 rounded-xl border border-zinc-700/60 bg-zinc-800/60 px-3 py-2.5 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={newDomainActive}
            onChange={(event) => setNewDomainActive(event.target.checked)}
            disabled={busy === "add"}
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-flame-500 focus:ring-flame-500/40"
          />
          Start active
        </label>

        <button
          type="submit"
          disabled={busy === "add" || newDomain.trim().length === 0}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-flame-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-flame-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "add" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          {busy === "add" ? "Adding..." : "Add domain"}
        </button>
      </form>

      <div className="mt-5 space-y-3">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading domains...
          </p>
        ) : null}
        {!loading && domains.length === 0 ? <p className="text-sm text-zinc-500">No domains configured yet.</p> : null}

        {domains.map((domain) => {
          const isBusy = busy === domain.domain;

          return (
            <div key={domain.domain} className="rounded-xl border border-zinc-800/50 bg-zinc-800/30 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="truncate text-sm font-semibold text-zinc-200">{domain.domain}</strong>
                    <span
                      className={[
                        "rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wider",
                        domain.isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-700/60 text-zinc-400",
                      ].join(" ")}
                    >
                      {domain.isActive ? "active" : "disabled"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    Added {fullDate(domain.createdAt)} · {domain.inboxCount} inbox
                    {domain.inboxCount !== 1 ? "es" : ""}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleToggle(domain)}
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {domain.isActive ? <PowerOff className="h-3 w-3" /> : <Power className="h-3 w-3" />}
                    {isBusy ? "Saving..." : domain.isActive ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    disabled={!domain.canDelete || isBusy}
                    onClick={() => void handleDelete(domain)}
                    className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                    title={domain.canDelete ? "Delete domain" : "Cannot delete a domain that still has inboxes"}
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
