import { useEffect, useState } from "react";
import { Globe, Loader2, Sparkles } from "lucide-react";
import { TurnstileWidget } from "@/client/components/turnstile-widget";
import { Button, Card, ErrorBanner } from "@/client/components/ui";
import { useTurnstileForm } from "@/client/hooks/useTurnstileForm";
import {
  TEMP_MAILBOX_TTL_HOURS,
  createInbox,
  getErrorMessage,
  isTurnstileError,
  listDomains,
  type InboxSession,
  type TempMailboxTtlHours,
} from "../lib/api";

const TTL_OPTION_DETAILS: Record<TempMailboxTtlHours, { hint: string; label: string }> = {
  24: { label: "24 hours", hint: "standard" },
  48: { label: "48 hours", hint: "extended" },
  72: { label: "72 hours", hint: "max" },
};

const TTL_OPTIONS = TEMP_MAILBOX_TTL_HOURS.map((value) => ({
  ...TTL_OPTION_DETAILS[value],
  value,
}));

interface CreateInboxProps {
  onCreated: (session: InboxSession) => void;
}

export function CreateInbox({ onCreated }: CreateInboxProps) {
  const [domains, setDomains] = useState<string[]>([]);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [ttlHours, setTtlHours] = useState<TempMailboxTtlHours>(TEMP_MAILBOX_TTL_HOURS[0]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { turnstileToken, setTurnstileToken, turnstileResetKey, handleTurnstileError, resetTurnstile } =
    useTurnstileForm({
      onTurnstileError: () => {
        setError(null);
      },
    });

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const items = await listDomains();
        if (!active) {
          return;
        }

        setDomains(items);
        setSelectedDomain(items[0] ?? "");
      } catch (nextError) {
        if (active) {
          setError(getErrorMessage(nextError));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedDomain) {
      setError("No active domains are configured yet.");
      return;
    }
    if (!turnstileToken) {
      setError("Complete human verification to continue.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const session = await createInbox(selectedDomain, ttlHours, turnstileToken);
      resetTurnstile();
      onCreated(session);
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      if (isTurnstileError(nextError)) {
        resetTurnstile();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card variant="accent">
      <span className="mb-2 inline-block text-xs font-semibold uppercase tracking-wider text-accent-400">
        Instant Address
      </span>
      <h2 className="text-lg font-semibold text-zinc-100">Create a temporary inbox</h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">
        Get a disposable address that lives on this device until it expires. Emails arrive in real time.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">
        Plus aliases like <span className="font-medium text-zinc-400">name+tag@domain</span> route to the same inbox,
        and each message shows the exact delivered address.
      </p>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <label className="block space-y-1.5">
          <span className="flex items-center gap-1.5 text-sm font-medium text-zinc-400">
            <Globe className="h-3.5 w-3.5" />
            Domain
          </span>
          <select
            value={selectedDomain}
            onChange={(event) => setSelectedDomain(event.target.value)}
            className="w-full rounded-xl border border-zinc-700/60 bg-zinc-800/80 px-4 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/30"
          >
            {domains.length === 0 ? <option value="">No active domains</option> : null}
            {domains.map((domain) => (
              <option key={domain} value={domain}>
                {domain}
              </option>
            ))}
          </select>
        </label>

        <div className="space-y-2">
          <span className="block text-sm font-medium text-zinc-400">Mailbox lifetime</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {TTL_OPTIONS.map((option) => {
              const selected = option.value === ttlHours;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTtlHours(option.value)}
                  className={[
                    "rounded-xl border px-4 py-3 text-left",
                    selected
                      ? "border-accent-500/50 bg-accent-500/10 text-zinc-100"
                      : "border-zinc-700/60 bg-zinc-800/60 text-zinc-400 hover:bg-zinc-800",
                  ].join(" ")}
                >
                  <strong className="block text-sm font-semibold">{option.label}</strong>
                  <span className="mt-1 block text-xs uppercase tracking-wider text-zinc-500">{option.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        <TurnstileWidget
          action="create_inbox"
          onError={handleTurnstileError}
          onTokenChange={setTurnstileToken}
          resetKey={turnstileResetKey}
        />

        <Button
          variant="primary"
          size="md"
          className="w-full"
          type="submit"
          loading={submitting}
          icon={submitting ? undefined : <Sparkles className="h-4 w-4" />}
          disabled={loading || !selectedDomain || !turnstileToken}
        >
          {submitting ? "Creating..." : "Create inbox"}
        </Button>
      </form>

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500" aria-busy="true">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading available domains...
        </p>
      ) : null}
      {error ? <ErrorBanner className="mt-4">{error}</ErrorBanner> : null}
      {!loading && domains.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No domains available yet. An admin needs to add one first.</p>
      ) : null}
    </Card>
  );
}
