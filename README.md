# 🔥 flamemail

**Disposable email inboxes that run entirely on Cloudflare's edge — no servers, no maintenance, no fuss.**

Create a temporary address, receive mail in real-time, and watch it auto-destruct when the clock runs out. Perfect for sign-up confirmations, testing, or anywhere you need a throwaway inbox.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zllovesuki/flamemail)

> [!NOTE]
> This project was **vibe coded** — spec, architecture, and implementation were all built with AI-assisted development.

---

## ✨ Highlights

- **Instant temporary inboxes** — one click, no sign-up required
- **Real-time delivery** — emails appear the moment they arrive via WebSocket
- **Self-destructing** — inboxes auto-expire after 24 / 48 / 72 hours
- **Plus aliases** — `name+tag@domain.com` routes to the base inbox; the original recipient is preserved per message
- **Multi-domain** — serve as many domains as you like from one deployment
- **Secure rendering** — HTML emails displayed in a sandboxed iframe
- **Human verification** — Cloudflare Turnstile protects inbox creation and admin login
- **Zero infrastructure** — 100% Cloudflare edge: Workers, D1, R2, KV, Durable Objects
- **Replica-aware reads** — request-scoped D1 Sessions + bookmarks keep inbox reads sequentially consistent when read replication is enabled
- **Admin panel** — manage domains, inspect inboxes, and browse seeded permanent inboxes
- **WAF-ready** — ships with a [Cloudflare WAF configuration guide](waf.md) for free-tier edge protection

---

## 🚀 Quick Start

Get a local dev environment running in under a minute:

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:local:init
npm run dev
```

That's it — open the URL printed in your terminal and create your first inbox.

Local development uses the Cloudflare Turnstile test keys in `.dev.vars.example`, so inbox creation and admin login work out of the box after copying the file. Replace those with a real widget's keys before deploying a public instance.

### Handy Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start the local dev server |
| `npm run email:local` | Send a test email to the local worker |
| `npm run db:local:reset` | Wipe and re-migrate the local D1 database |
| `npm run check` | Type-check the entire project |
| `npm run build` | Build the frontend for production |

---

## 🏗️ How It Works

```
Inbound Email
  → Cloudflare Email Routing (catch-all)
  → Worker email() handler
  → Parse with postal-mime & store
      ├─ D1: email metadata
      ├─ R2: raw .eml, parsed body, attachments
      └─ Durable Object: push WebSocket notification
  → HTTP API uses request-scoped D1 Sessions + `x-d1-bookmark`
  → React SPA updates the inbox in real-time
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Cloudflare Workers |
| **Frontend** | React + Tailwind CSS (Vite) |
| **Real-time** | Durable Objects — Hibernation WebSocket API |
| **Database** | D1 (SQLite) + Drizzle ORM + D1 Sessions |
| **Object Storage** | R2 — raw `.eml`, parsed bodies, attachments |
| **Sessions** | KV — access tokens with auto-expiring TTL |
| **API Router** | Hono |
| **Email Parsing** | postal-mime |
| **Human Verification** | Cloudflare Turnstile |

---

## 🌐 Deploying to Production

Click the **Deploy to Cloudflare Workers** button at the top, or deploy manually:

```bash
npm run db:migrate
npx wrangler deploy
```

### Prerequisites

1. A **Cloudflare account** with Workers, D1, R2, and KV enabled.
2. **[Email Routing](https://developers.cloudflare.com/email-routing/)** enabled for each domain, with a catch-all rule pointing to this worker.
3. An **`ADMIN_PASSWORD`** secret:
   ```bash
   wrangler secret put ADMIN_PASSWORD
   ```
   Must be ≥ 16 characters with at least 3 of 4 character classes (lowercase, uppercase, digit, symbol). Admin APIs fail closed if this is missing or too weak.
4. A **Cloudflare Turnstile widget** for your deployed hostname, plus Worker bindings for:
   - `TURNSTILE_SITE_KEY` — public site key returned by `/api/config`
   - `TURNSTILE_SECRET_KEY` — secret used by the Worker to verify challenge responses

   If Turnstile is not configured, flamemail fails closed and blocks inbox creation plus admin login.
5. Optional but recommended: enable **D1 read replication** in the Cloudflare dashboard for lower global read latency. flamemail already propagates D1 bookmarks on HTTP requests, so read replication can be enabled without app code changes.

---

## 🔒 Security at a Glance

- **Inbox access** — each temporary inbox gets a unique token stored in KV; expires with the inbox
- **Admin access** — password-authenticated sessions with 1-hour TTL
- **Human verification** — `POST /api/inboxes` and `POST /api/admin/login` require a valid Turnstile token before the Worker creates state or evaluates admin credentials
- **WebSocket upgrades** — require origin validation + a one-time ticket consumed on connect
- **Replica consistency** — inbox/admin HTTP requests propagate D1 bookmarks so replica reads stay sequentially consistent across requests
- **Email rendering** — HTML is sanitized and served inside a sandboxed iframe with strict CSP
- **Inbound guardrails** — rejects messages > 10 MiB, > 10 attachments, or when an inbox already holds 100 emails

---

## 📁 Project Structure

```
src/
├── client/                # React SPA (Vite)
│   ├── components/        # UI components
│   ├── hooks/             # React hooks (WebSocket, inbox state)
│   ├── lib/               # API client, HTML sanitization, helpers
│   └── App.tsx            # Routes & layout
└── worker/                # Cloudflare Worker
    ├── api/               # Hono route handlers
    ├── db/                # Drizzle schema, relations, DB factory
    ├── durable-objects/   # InboxWebSocket Durable Object
    ├── services/          # Business logic (inbox lifecycle, R2 storage)
    ├── email-handler.ts   # Inbound email processing
    └── index.ts           # Worker entry — fetch, email, scheduled
```

See [`spec.md`](spec.md) for the full architecture, API reference, data-flow diagrams, and design rationale.

---

## 🤝 Contributing

Contributions are welcome! The codebase follows a clear client/worker split — check out [`AGENTS.md`](AGENTS.md) for detailed change guidelines, recommended workflows, and security considerations.

```bash
# Verify your changes compile cleanly
npm run check
```

---

## 📄 License

[MIT](LICENSE) — use it however you like.
