import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, LogOut, Shield } from "lucide-react";
import { TurnstileWidget } from "@/client/components/TurnstileWidget";
import { DomainManager } from "@/client/components/admin/DomainManager";
import { PermanentInboxList } from "@/client/components/admin/PermanentInboxList";
import { TempInboxList } from "@/client/components/admin/TempInboxList";
import { toast } from "@/client/components/Toast";
import { useAdminSessionGuard } from "@/client/hooks/useAdminSessionGuard";
import { useTurnstileForm } from "@/client/hooks/useTurnstileForm";
import {
  adminLogin,
  clearAdminToken,
  getAdminToken,
  getErrorMessage,
  isAdminAccessDisabledError,
  isTurnstileError,
  listAdminDomains,
  listAdminInboxes,
  setAdminToken,
  type AdminDomain,
  type AdminInbox,
} from "@/client/lib/api";

export function AdminLogin() {
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(() => getAdminToken());
  const [domains, setDomains] = useState<AdminDomain[]>([]);
  const [inboxes, setInboxes] = useState<AdminInbox[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { turnstileToken, setTurnstileToken, turnstileResetKey, handleTurnstileError, resetTurnstile } =
    useTurnstileForm({
      onTurnstileError: () => {
        setError(null);
      },
    });

  const resetAdminState = useCallback((message?: string) => {
    clearAdminToken();
    setToken(null);
    setDomains([]);
    setInboxes([]);
    setError(null);

    if (message) {
      toast.error(message);
    }
  }, []);
  const handleAdminSessionError = useAdminSessionGuard(resetAdminState);

  const reload = useCallback(async (currentToken: string) => {
    const nextDomains = await listAdminDomains(currentToken);
    const nextInboxes = await listAdminInboxes(currentToken);

    setDomains(nextDomains);
    setInboxes(nextInboxes);
  }, []);

  useEffect(() => {
    if (!token) {
      setDomains([]);
      setInboxes([]);
      return;
    }

    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        await reload(token);
      } catch (nextError) {
        if (!active) {
          return;
        }

        if (handleAdminSessionError(nextError, setError)) {
          return;
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
  }, [handleAdminSessionError, reload, token]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!turnstileToken) {
      setError("Complete human verification to continue.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await adminLogin(password, turnstileToken);
      setAdminToken(response.token);
      setToken(response.token);
      setPassword("");
      resetTurnstile();
      toast.success("Admin session started");
    } catch (nextError) {
      if (isAdminAccessDisabledError(nextError)) {
        resetAdminState(getErrorMessage(nextError));
      } else {
        toast.error(getErrorMessage(nextError));
      }
      if (isTurnstileError(nextError)) {
        resetTurnstile();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    resetAdminState();
    toast.info("Admin session cleared");
  };

  const handleReload = async () => {
    if (token) {
      await reload(token);
    }
  };

  return (
    <main className="animate-slide-up space-y-6">
      {token ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-grid h-9 w-9 place-items-center rounded-lg bg-flame-500/10">
              <Shield className="h-5 w-5 text-flame-400" />
            </span>
            <div>
              <h1 className="text-base font-semibold text-zinc-100">Admin console</h1>
              <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Authenticated
              </span>
            </div>
          </div>
          <button
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700/60"
            type="button"
            onClick={handleLogout}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </section>
      ) : (
        <section className="rounded-2xl border border-flame-500/20 bg-gradient-to-br from-zinc-900 to-zinc-900/80 p-6">
          <div className="mb-2 flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-flame-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-flame-400">Reserved Access</span>
          </div>
          <h1 className="text-xl font-semibold text-zinc-100">Admin console</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Sign in with the admin password to manage domains, inspect temporary inboxes, and browse permanent inboxes.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            Admin access is limited to this browser session and is cleared when you close the tab or sign out.
          </p>

          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            <label className="block space-y-1.5">
              <span className="flex items-center gap-1.5 text-sm font-medium text-zinc-400">
                <KeyRound className="h-3.5 w-3.5" />
                Admin password
              </span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter ADMIN_PASSWORD"
                className="w-full rounded-xl border border-zinc-700/60 bg-zinc-800/80 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-flame-500/50 focus:ring-1 focus:ring-flame-500/30"
              />
            </label>

            <TurnstileWidget
              action="admin_login"
              onError={handleTurnstileError}
              onTokenChange={setTurnstileToken}
              resetKey={turnstileResetKey}
            />

            <button
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-flame-500 to-flame-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-flame-500/20 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
              type="submit"
              disabled={loading || password.length === 0 || !turnstileToken}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          {error ? (
            <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          ) : null}
        </section>
      )}

      {token ? (
        <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <DomainManager
              token={token}
              domains={domains}
              loading={loading}
              onAdminSessionError={resetAdminState}
              onReload={handleReload}
            />
            <TempInboxList token={token} onSessionError={resetAdminState} />
          </div>
          <PermanentInboxList inboxes={inboxes} loading={loading} />
        </section>
      ) : null}
    </main>
  );
}
