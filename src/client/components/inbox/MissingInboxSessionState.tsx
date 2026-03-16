import { ShieldAlert } from "lucide-react";

export function MissingInboxSessionState() {
  return (
    <main className="animate-slide-up">
      <section className="flex min-h-[320px] items-center justify-center rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="inline-grid h-14 w-14 place-items-center rounded-full bg-zinc-800/60">
            <ShieldAlert className="h-7 w-7 text-zinc-600" />
          </span>
          <div>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Missing Session
            </span>
            <h1 className="text-xl font-semibold text-zinc-200">This inbox is not stored locally</h1>
            <p className="mt-3 max-w-md text-sm text-zinc-500">
              Open it from the device that created it before the inbox expires, or sign in as an admin for permanent
              inboxes.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
