# AGENTS.md

## Purpose

`flamemail` is a transactional-email testing service on Cloudflare's edge. It has a React SPA frontend and a Cloudflare Worker backend for HTTP APIs, Turnstile-backed inbox creation, tessera-backed admin auth, inbound email ingestion, WebSocket fanout, and scheduled cleanup.

Use this file for repo-specific safety rails. Use `README.md` for setup/deploy instructions, `spec.md` for detailed architecture and API rationale, `wrangler.jsonc` for Cloudflare bindings, and `package.json` for scripts.

## Start Here

- Client entry and routes: `src/client/main.tsx`, `src/client/App.tsx`.
- Client API helpers and session/bookmark handling: `src/client/lib/api/`.
- Email HTML safety: `src/client/lib/email-html/`.
- Worker entry: `src/worker/index.ts` exports `fetch()`, `email()`, `scheduled()`, and `InboxWebSocket`.
- HTTP routing and D1 session/bookmark setup: `src/worker/router.ts`.
- API route handlers: `src/worker/api/`; keep reusable behavior in `src/worker/services/`.
- Inbox lifecycle, domains, cleanup, sessions, and WebSocket tickets: `src/worker/services/inbox/`.
- Inbound email pipeline: `src/worker/email-handler.ts`.
- Auth, cookies, origin checks, Turnstile, and OIDC: `src/worker/middleware/`, `src/worker/security.ts`, `src/worker/services/cookies.ts`, `src/worker/services/oidc.ts`, `src/worker/services/turnstile.ts`.
- Database schema and migrations: `src/worker/db/schema.ts`, `drizzle/`.

## Change Rules

- Prefer minimal, targeted changes and preserve the client/worker split.
- Do not introduce secrets into source control.
- Keep imports at the top of files and follow existing local patterns.
- Keep `src/shared/contracts/`, worker routes, and client API helpers aligned for any request/response shape change.
- Prefer `@cloudflare/util-en-garde` for new validated shapes.
- API changes belong in `src/worker/api/`, must be registered through `src/worker/router.ts`, and should push business logic into services.
- Frontend routes belong in `src/client/App.tsx`; API calls belong in `src/client/lib/api/`.
- Database changes require `src/worker/db/schema.ts` plus a reviewed Drizzle migration in `drizzle/`; apply schema changes locally before remote migration.
- Run `npm run check` when practical. For docs-only changes, a targeted Prettier check is enough.

## Security Invariants

- Treat inbound email content, HTML, attachments, links, headers, params, and API bodies as hostile.
- `/api/*` and `/ws` requests must run through the Worker before static asset handling; preserve `run_worker_first` behavior in `wrangler.jsonc`.
- Anonymous inbox creation requires a valid Turnstile token and fails closed if Turnstile config or verification is missing, invalid, or unavailable.
- Admin access requires tessera OIDC plus a `sub` in `TESSERA_OPERATOR_SUBS`; missing config, an empty allowlist, or failed discovery must fail closed with `ADMIN_ACCESS_DISABLED`.
- Register tessera redirects as `<flamemail-origin>/api/public/admin/callback`.
- Admin sessions live in KV and an `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-flamemail-admin` cookie. OIDC transaction state lives only in the sealed `__Host-flamemail-oidc` cookie.
- Admin inspection on inbox routes requires explicit `?admin=1`; cookie-authenticated mutations require same-origin checks.
- Admin inspection of temporary inboxes is read-only except deleting the inbox itself.
- WebSocket upgrades require a valid origin and one-time ticket.
- D1 bookmarks use the `x-d1-bookmark` header so reads can observe recent writes without forcing every request to primary.
- Active domains seed permanent `admin`, `postmaster`, `abuse`, and `webmaster` inboxes.
- Temporary inboxes expire and are purged by the hourly cron; cleanup changes must not leave access tokens or stored content behind.
- Plus aliases route to the same base inbox, while each email record preserves the exact delivered recipient address.
- Email HTML must remain sandboxed, remote resources blocked by default, and external links rewritten through `/link`.
- Delete and cleanup flows must consider D1 rows, KV session/ticket state, R2 objects, and Durable Object notifications. Revoke access and remove R2 objects before deleting D1 rows.

## Task Checklist

- API change: update route, shared contract, client helper, router registration, and `npm run check`.
- Inbox lifecycle/storage change: account for D1, KV, R2, Durable Object side effects, cleanup, and real-time behavior.
- UI/security change: preserve session persistence, D1 bookmark propagation, Turnstile, OIDC, WebSocket isolation, and email HTML safety.
- Schema change: update schema, generate/review migration, apply locally, and re-test affected flows.

## Local Notes

- Assume the dev server is already running. Do not start `npm run dev` again unless the user asks or you have verified no relevant server is running.
- Local admin sign-in uses `npm run oidc:local` with the `.dev.vars.example` tessera values; see `README.md` for setup details.
- Cloudflare Email Routing catch-all rules are configured in the Cloudflare dashboard, not in code.
