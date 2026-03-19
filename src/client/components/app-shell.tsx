import { useMemo, useState } from "react";
import { Outlet } from "react-router-dom";
import { Header } from "@/client/components/Header";
import { Footer } from "@/client/components/Footer";
import { ToastContainer } from "@/client/components/Toast";
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
      <Header sessionCount={sessionCount} />
      <main>
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <Outlet context={context} />
        </div>
      </main>
      <Footer />
      <ToastContainer />
    </div>
  );
}
