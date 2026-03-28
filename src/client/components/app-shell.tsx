import { useMemo, useState } from "react";
import { Outlet } from "react-router-dom";
import { Header } from "@/client/components/header";
import { Footer } from "@/client/components/footer";
import { ToastContainer } from "@/client/components/toast";
import { loadInboxSessions, storeInboxSession, type InboxSession, type InboxSessionSummary } from "@/client/lib/api";

export interface AppShellContext {
  sessions: InboxSessionSummary[];
  onCreated: (session: InboxSession) => void;
  onDeleted: (address: string) => void;
}

export function AppShell() {
  const [sessions, setSessions] = useState<InboxSessionSummary[]>(() => loadInboxSessions());
  const sessionCount = useMemo(() => sessions.length, [sessions]);

  const handleCreated = (session: InboxSession) => {
    setSessions(storeInboxSession(session));
  };

  const handleDeleted = (_address: string) => {
    setSessions(loadInboxSessions());
  };

  const context: AppShellContext = {
    sessions,
    onCreated: handleCreated,
    onDeleted: handleDeleted,
  };

  return (
    <div className="relative z-10 min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-200 focus:rounded-lg focus:bg-zinc-900 focus:px-4 focus:py-2 focus:text-accent-400 focus:ring-2 focus:ring-accent-500/50"
      >
        Skip to content
      </a>
      <Header sessionCount={sessionCount} />
      <main id="main-content">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <Outlet context={context} />
        </div>
      </main>
      <Footer />
      <ToastContainer />
    </div>
  );
}
