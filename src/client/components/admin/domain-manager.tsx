import { useState } from "react";
import { Globe, Loader2, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { toast } from "@/client/components/toast";
import { Badge, Button, Card, PageHeader } from "@/client/components/ui";
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
    <Card>
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          caption="Domain Pool"
          captionIcon={<Globe className="h-3.5 w-3.5 text-zinc-500" />}
          heading="Manage inbound domains"
          description="Active domains are available for public inbox creation. Disabled domains no longer accept new temporary inboxes or inbound mail."
        />
        <Badge>
          {domains.length} domain{domains.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      <form className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]" onSubmit={handleAdd}>
        <input
          type="text"
          value={newDomain}
          onChange={(event) => setNewDomain(event.target.value)}
          placeholder="example.com"
          disabled={busy === "add"}
          className="w-full rounded-xl border border-zinc-700/60 bg-zinc-800/80 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/30 disabled:opacity-50"
        />

        <label className="flex items-center gap-2 rounded-xl border border-zinc-700/60 bg-zinc-800/60 px-3 py-2.5 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={newDomainActive}
            onChange={(event) => setNewDomainActive(event.target.checked)}
            disabled={busy === "add"}
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-accent-500 focus:ring-accent-500/40"
          />
          Start active
        </label>

        <Button
          variant="primary"
          size="md"
          type="submit"
          loading={busy === "add"}
          icon={busy !== "add" ? <Plus className="h-3.5 w-3.5" /> : undefined}
          disabled={newDomain.trim().length === 0}
        >
          {busy === "add" ? "Adding..." : "Add domain"}
        </Button>
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
                    <Badge
                      variant={domain.isActive ? "success" : "muted"}
                      className="text-[11px] uppercase tracking-wider"
                    >
                      {domain.isActive ? "active" : "disabled"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    Added {fullDate(domain.createdAt)} · {domain.inboxCount} inbox
                    {domain.inboxCount !== 1 ? "es" : ""}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    icon={domain.isActive ? <PowerOff className="h-3 w-3" /> : <Power className="h-3 w-3" />}
                    disabled={isBusy}
                    onClick={() => void handleToggle(domain)}
                  >
                    {isBusy ? "Saving..." : domain.isActive ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    variant="danger"
                    icon={<Trash2 className="h-3 w-3" />}
                    disabled={!domain.canDelete || isBusy}
                    onClick={() => void handleDelete(domain)}
                    title={domain.canDelete ? "Delete domain" : "Cannot delete a domain that still has inboxes"}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
