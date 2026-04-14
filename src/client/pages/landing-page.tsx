import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { Clock, Mail } from "lucide-react";
import { CreateInbox } from "@/client/components/create-inbox";
import { Card } from "@/client/components/ui";
import type { AppShellContext } from "@/client/components/app-shell";
import { fullDate } from "@/client/lib/time";

export function LandingPage() {
  const { sessions, onCreated } = useOutletContext<AppShellContext>();
  const navigate = useNavigate();

  return (
    <div className="animate-slide-up space-y-8">
      {/* Compact hero */}
      <section className="text-center">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-zinc-100 sm:text-4xl">
          Disposable inboxes on the Edge.
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-zinc-400">
          Temporary email that self-destructs. Real-time delivery, sandboxed HTML, automatic cleanup — no signup
          required.
        </p>
      </section>

      {/* Create form + recent inboxes */}
      <div className="grid gap-6 lg:grid-cols-[minmax(280px,440px)_minmax(0,1fr)]">
        <CreateInbox
          onCreated={(session) => {
            onCreated(session);
            navigate(`/inbox/${encodeURIComponent(session.address)}`);
          }}
        />

        <Card>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            <Mail className="h-3.5 w-3.5" />
            Recent inboxes
          </h2>

          {sessions.length === 0 ? (
            <p className="mt-4 text-sm leading-relaxed text-zinc-400">
              No inboxes yet. Created addresses are saved on this device and removed when they expire.
            </p>
          ) : (
            <div className="mt-4 space-y-1.5">
              {sessions.map((session, i) => {
                const expires = new Date(session.expiresAt);
                const remaining = expires.getTime() - Date.now();
                const alive = remaining > 0;

                return (
                  <Link
                    key={session.address}
                    className="animate-scale-fade opacity-0 group flex items-center gap-3 rounded-lg border border-zinc-800/50 bg-zinc-800/30 px-4 py-3 hover:border-zinc-700/60 hover:bg-zinc-800/60 hover:-translate-y-0.5 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                    style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
                    to={`/inbox/${encodeURIComponent(session.address)}`}
                  >
                    <span
                      className={`inline-grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                        alive ? "bg-accent-500/10 text-accent-400" : "bg-zinc-800 text-zinc-600"
                      }`}
                    >
                      <Mail className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-sm font-medium text-zinc-200 group-hover:text-accent-400">
                        {session.address}
                      </strong>
                      <span className="flex items-center gap-1 text-xs text-zinc-400">
                        <Clock className="h-3 w-3" />
                        {alive ? `expires ${fullDate(session.expiresAt)}` : "expired"}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
