import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, LogOut, Shield } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { DomainManager } from "@/client/components/admin/domain-manager";
import { PermanentInboxList } from "@/client/components/admin/permanent-inbox-list";
import { TempInboxList } from "@/client/components/admin/temp-inbox-list";
import { toast } from "@/client/components/toast";
import { Button, Card, ErrorBanner, buttonClasses } from "@/client/components/ui";
import {
  ApiError,
  adminLogout,
  adminSignInUrl,
  clearAdminBookmark,
  getErrorMessage,
  isAdminAccessDisabledError,
  listAdminDomains,
  listAdminInboxes,
  type AdminDomain,
  type AdminInbox,
} from "@/client/lib/api";

const ERROR_COPY: Record<string, string> = {
  ADMIN_ACCESS_DISABLED: "Admin access is unavailable because tessera OIDC is not configured or cannot be discovered.",
  invalid_request: "Sign-in request was missing required parameters.",
  invalid_state: "Sign-in handshake state was invalid or expired. Try signing in again.",
  missing_state: "Sign-in handshake cookie was missing. Try signing in again.",
  token_exchange_failed: "tessera rejected the authorization code. Try signing in again.",
  invalid_id_token: "tessera returned an unexpected ID token. Try signing in again.",
  not_operator: "This tessera account is not authorized for admin access.",
  session_create_failed: "Could not create the admin session. Try signing in again.",
};

function describeError(code: string | null) {
  if (!code) {
    return null;
  }
  return ERROR_COPY[code] ?? "Sign-in failed. Try again.";
}

export function AdminLogin() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialError = describeError(searchParams.get("error"));
  const initialErrorRef = useRef(initialError);
  const [authenticated, setAuthenticated] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accessDisabled, setAccessDisabled] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [domains, setDomains] = useState<AdminDomain[]>([]);
  const [inboxes, setInboxes] = useState<AdminInbox[]>([]);

  const reload = useCallback(async () => {
    const [nextDomains, nextInboxes] = await Promise.all([listAdminDomains(), listAdminInboxes()]);
    setDomains(nextDomains);
    setInboxes(nextInboxes);
  }, []);

  const reset = useCallback((message?: string) => {
    clearAdminBookmark();
    setAuthenticated(false);
    setDomains([]);
    setInboxes([]);
    setError(message ?? null);
  }, []);

  useEffect(() => {
    let active = true;

    const boot = async () => {
      try {
        await reload();
        if (!active) return;
        setAuthenticated(true);
        setError(null);
      } catch (nextError) {
        if (!active) return;
        if (isAdminAccessDisabledError(nextError)) {
          setAccessDisabled(true);
          reset(getErrorMessage(nextError));
          return;
        }
        if (nextError instanceof ApiError && (nextError.status === 401 || nextError.status === 403)) {
          // Cookie missing or rejected; keep the existing error from
          // ?error= if present, otherwise stay quiet.
          reset(initialErrorRef.current ?? undefined);
          return;
        }
        reset(getErrorMessage(nextError));
      } finally {
        if (active) {
          setBootLoading(false);
        }
      }
    };

    void boot();
    return () => {
      active = false;
    };
  }, [reload, reset]);

  // Drop ?error= from the URL once we have rendered it once so a refresh
  // after a successful sign-in does not re-show the banner.
  useEffect(() => {
    if (!searchParams.get("error")) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("error");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleReload = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
      setError(null);
      setAccessDisabled(false);
    } catch (nextError) {
      if (isAdminAccessDisabledError(nextError)) {
        setAccessDisabled(true);
        reset(getErrorMessage(nextError));
        throw nextError;
      }
      if (nextError instanceof ApiError && (nextError.status === 401 || nextError.status === 403)) {
        reset();
        throw nextError;
      }
      setError(getErrorMessage(nextError));
      throw nextError;
    } finally {
      setRefreshing(false);
    }
  }, [reload, reset]);

  const handleLogout = useCallback(async () => {
    try {
      await adminLogout();
      reset();
      toast.info("Admin session cleared");
    } catch (nextError) {
      toast.error(getErrorMessage(nextError));
    }
  }, [reset]);

  if (bootLoading) {
    return (
      <main className="animate-slide-up space-y-6">
        <Card className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading admin console...
        </Card>
      </main>
    );
  }

  return (
    <main className="animate-slide-up space-y-6">
      {authenticated ? (
        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-grid h-9 w-9 place-items-center rounded-lg bg-accent-500/10">
              <Shield className="h-5 w-5 text-accent-400" />
            </span>
            <div>
              <h1 className="text-base font-semibold text-zinc-100">Admin console</h1>
              <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Authenticated via tessera
              </span>
            </div>
          </div>
          <Button icon={<LogOut className="h-3.5 w-3.5" />} onClick={() => void handleLogout()}>
            Sign out
          </Button>
        </Card>
      ) : (
        <Card variant="accent">
          <div className="mb-2 flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-accent-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-accent-400">Reserved Access</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Admin console</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Sign in with tessera to manage domains, inspect temporary inboxes, and browse permanent inboxes.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">
            Admin access is limited to operators allowlisted in tessera.
          </p>

          {accessDisabled ? (
            <Button
              variant="primary"
              size="md"
              disabled
              icon={<ExternalLink className="h-3.5 w-3.5" />}
              className="mt-5"
            >
              Sign in with tessera
            </Button>
          ) : (
            <a href={adminSignInUrl()} className={buttonClasses({ variant: "primary", size: "md", className: "mt-5" })}>
              <ExternalLink className="h-3.5 w-3.5" />
              Sign in with tessera
            </a>
          )}

          {error ? <ErrorBanner className="mt-4">{error}</ErrorBanner> : null}
        </Card>
      )}

      {authenticated ? (
        <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <DomainManager domains={domains} loading={refreshing} onAdminSessionError={reset} onReload={handleReload} />
            <TempInboxList onSessionError={reset} />
          </div>
          <PermanentInboxList inboxes={inboxes} loading={refreshing} />
        </section>
      ) : null}
    </main>
  );
}
