import { Cloud, Database, Globe, HardDrive, Key, Mail, Radio, Shield, Timer } from "lucide-react";

const STACK = [
  { icon: Cloud, label: "Cloudflare Workers", desc: "Serverless runtime for API, email handling, and cron cleanup" },
  { icon: Database, label: "D1 (SQLite)", desc: "Inbox and email metadata with Drizzle ORM" },
  { icon: HardDrive, label: "R2", desc: "Object storage for email bodies and attachments" },
  { icon: Key, label: "KV", desc: "Session tokens with automatic TTL expiry" },
  { icon: Radio, label: "Durable Objects", desc: "Hibernation WebSocket API for real-time push notifications" },
  { icon: Mail, label: "Email Routing", desc: "Catch-all rules forward inbound mail to the Worker" },
];

const FEATURES = [
  {
    icon: Timer,
    title: "Temporary inboxes",
    desc: "Create a disposable address that self-destructs after 24, 48, or 72 hours.",
  },
  { icon: Radio, title: "Real-time delivery", desc: "Emails appear instantly via WebSocket — no polling, no refresh." },
  {
    icon: Globe,
    title: "Multi-domain",
    desc: "Bring your own domains. Each one gets catch-all routing and reserved admin mailboxes.",
  },
  {
    icon: Shield,
    title: "Admin dashboard",
    desc: "Manage domains, inspect temporary inboxes, and monitor permanent mailboxes.",
  },
];

export function About() {
  return (
    <main className="animate-slide-up mx-auto max-w-3xl space-y-10 pt-2">
      {/* Intro */}
      <section>
        <h1 className="text-xl font-bold text-zinc-100 sm:text-2xl">About Flamemail</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400 sm:text-base">
          Flamemail is a temporary email service that runs entirely on Cloudflare's developer platform. It provides
          disposable inboxes with real-time email delivery, sandboxed HTML rendering, and automatic cleanup — no
          traditional server required.
        </p>
      </section>

      {/* Features */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Features</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
              <f.icon className="h-5 w-5 text-flame-400" />
              <h3 className="mt-2 text-sm font-semibold text-zinc-200">{f.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Tech stack */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Technology stack</h2>
        <div className="mt-4 space-y-2">
          {STACK.map((s) => (
            <div
              key={s.label}
              className="flex items-start gap-3 rounded-xl border border-zinc-800/50 bg-zinc-800/30 px-4 py-3"
            >
              <span className="inline-grid h-7 w-7 shrink-0 place-items-center rounded-full bg-flame-500/10 text-flame-400">
                <s.icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <strong className="block text-sm font-medium text-zinc-200">{s.label}</strong>
                <span className="text-xs text-zinc-500">{s.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">How it works</h2>
        <ol className="mt-4 space-y-3 text-sm leading-relaxed text-zinc-400">
          <li className="flex gap-3">
            <span className="inline-grid h-6 w-6 shrink-0 place-items-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300">
              1
            </span>
            <span>
              <strong className="text-zinc-200">Create an inbox</strong> — pick a domain and lifetime. You get a random
              address and an access token stored in your browser.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="inline-grid h-6 w-6 shrink-0 place-items-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300">
              2
            </span>
            <span>
              <strong className="text-zinc-200">Receive email</strong> — Cloudflare Email Routing forwards inbound mail
              to the Worker, which parses it, stores the body in R2, and writes metadata to D1.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="inline-grid h-6 w-6 shrink-0 place-items-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300">
              3
            </span>
            <span>
              <strong className="text-zinc-200">Instant notification</strong> — a Durable Object wakes up just long
              enough to push the new-email event over WebSocket, then hibernates again.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="inline-grid h-6 w-6 shrink-0 place-items-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300">
              4
            </span>
            <span>
              <strong className="text-zinc-200">Automatic cleanup</strong> — an hourly cron purges expired inboxes,
              their emails, and all R2 objects.
            </span>
          </li>
        </ol>
      </section>
    </main>
  );
}
