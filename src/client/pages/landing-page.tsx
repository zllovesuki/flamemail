import { Link } from "react-router-dom";
import { Cloud, Database, Globe, HardDrive, Key, Mail, Plus, Radio, Shield, Terminal, Timer } from "lucide-react";

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

export function LandingPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-16 pt-8 pb-16">
      {/* Hero Showcase */}
      <section className="animate-slide-up flex flex-col items-center text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent-500/30 bg-accent-500/10 px-3 py-1 text-xs font-medium tracking-wide text-accent-400">
          <Terminal className="h-3.5 w-3.5" />
          Powered by Cloudflare Workers
        </div>
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-zinc-100 sm:text-5xl lg:text-6xl">
          Disposable inboxes on the Edge.
        </h1>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-zinc-400 sm:text-lg">
          flamemail is a temporary email service that runs entirely on Cloudflare's developer platform. Real-time
          delivery, sandboxed HTML rendering, and automatic cleanup — no traditional server required.
        </p>

        <Link
          to="/create"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent-500 to-accent-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-accent-500/10 transition-transform hover:from-accent-400 hover:to-accent-500 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Create an inbox
        </Link>

        {/* Stylized Component Showcase (Mock Terminal / Pipeline) */}
        <div className="mt-12 w-full max-w-3xl overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/50 shadow-2xl shadow-accent-500/5">
          <div className="flex items-center gap-2 border-b border-zinc-800/60 bg-zinc-950/50 px-4 py-3">
            <div className="flex gap-1.5">
              <div className="h-3 w-3 rounded-full bg-zinc-700/50"></div>
              <div className="h-3 w-3 rounded-full bg-zinc-700/50"></div>
              <div className="h-3 w-3 rounded-full bg-zinc-700/50"></div>
            </div>
            <span className="ml-2 font-mono text-xs text-zinc-500">worker.ts — email pipeline</span>
          </div>
          <div className="p-4 text-left font-mono text-xs leading-relaxed text-zinc-300 sm:p-6 sm:text-sm">
            <div className="flex gap-4">
              <span className="text-zinc-600">01</span>
              <span>
                <span className="text-accent-400">export default</span> {"{"}
              </span>
            </div>
            <div className="flex gap-4">
              <span className="text-zinc-600">02</span>
              <span className="pl-4">
                <span className="text-emerald-400">async</span> email(message, env, ctx) {"{"}
              </span>
            </div>
            <div className="flex gap-4 opacity-50">
              <span className="text-zinc-600">03</span>
              <span className="pl-8 text-zinc-500">// 1. Parse inbound stream</span>
            </div>
            <div className="flex gap-4">
              <span className="text-zinc-600">04</span>
              <span className="pl-8">
                <span className="text-zinc-400">const</span> parsed = <span className="text-emerald-400">await</span>{" "}
                parseEmail(message.raw);
              </span>
            </div>
            <div className="flex gap-4 opacity-50">
              <span className="text-zinc-600">05</span>
              <span className="pl-8 text-zinc-500">// 2. Store body in R2</span>
            </div>
            <div className="flex gap-4">
              <span className="text-zinc-600">06</span>
              <span className="pl-8">
                <span className="text-emerald-400">await</span> env.STORAGE.put(id, parsed.html);
              </span>
            </div>
            <div className="flex gap-4 opacity-50">
              <span className="text-zinc-600">07</span>
              <span className="pl-8 text-zinc-500">// 3. Notify connected clients via WebSocket</span>
            </div>
            <div className="flex gap-4">
              <span className="text-zinc-600">08</span>
              <span className="pl-8">
                <span className="text-emerald-400">await</span> env.INBOX_WS.get(id).fetch(event);
              </span>
            </div>
            <div className="flex gap-4">
              <span className="text-zinc-600">09</span>
              <span className="pl-4">{"}"}</span>
            </div>
            <div className="flex gap-4">
              <span className="text-zinc-600">10</span>
              <span>{"}"}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Two-Column Grid for Features & Tech Stack */}
      <div className="grid gap-12 md:grid-cols-2">
        {/* Features */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Features</h2>
          <dl className="mt-6 space-y-6">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="animate-slide-up opacity-0"
                style={{ animationDelay: `${Math.min(i, 8) * 60 + 200}ms` }}
              >
                <dt className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                  <f.icon className="h-4 w-4 text-accent-400" aria-hidden="true" />
                  {f.title}
                </dt>
                <dd className="mt-1 pl-6 text-sm leading-relaxed text-zinc-400">{f.desc}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Tech stack */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Technology stack</h2>
          <div className="mt-6 space-y-3">
            {STACK.map((s, i) => (
              <div
                key={s.label}
                className="animate-scale-fade flex items-start gap-3 rounded-xl border border-zinc-800/50 bg-zinc-800/30 px-4 py-3 opacity-0"
                style={{ animationDelay: `${Math.min(i, 8) * 60 + 300}ms` }}
              >
                <span className="inline-grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-500/10 text-accent-400">
                  <s.icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <strong className="block text-sm font-medium text-zinc-200">{s.label}</strong>
                  <span className="text-xs text-zinc-500">{s.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* How it works */}
      <section className="animate-slide-up opacity-0" style={{ animationDelay: "500ms" }}>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">How it works</h2>
        <div className="mt-6 rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-6 sm:p-8">
          <ol className="space-y-6 text-sm leading-relaxed text-zinc-400">
            <li className="flex gap-4">
              <span className="inline-grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300">
                1
              </span>
              <span className="pt-1.5">
                <strong className="text-zinc-200">Create an inbox</strong> — pick a domain and lifetime. You get a
                random address and an access token stored in your browser.
              </span>
            </li>
            <li className="flex gap-4">
              <span className="inline-grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300">
                2
              </span>
              <span className="pt-1.5">
                <strong className="text-zinc-200">Receive email</strong> — Cloudflare Email Routing forwards inbound
                mail to the Worker, which parses it, stores the body in R2, and writes metadata to D1.
              </span>
            </li>
            <li className="flex gap-4">
              <span className="inline-grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300">
                3
              </span>
              <span className="pt-1.5">
                <strong className="text-zinc-200">Instant notification</strong> — a Durable Object wakes up just long
                enough to push the new-email event over WebSocket, then hibernates again.
              </span>
            </li>
            <li className="flex gap-4">
              <span className="inline-grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300">
                4
              </span>
              <span className="pt-1.5">
                <strong className="text-zinc-200">Automatic cleanup</strong> — an hourly cron purges expired inboxes,
                their emails, and all R2 objects.
              </span>
            </li>
          </ol>
        </div>
      </section>
    </div>
  );
}
