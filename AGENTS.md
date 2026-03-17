# AGENTS.md

## Purpose

`flamemail` is a disposable email service on Cloudflare's edge. It has a React SPA frontend and a Cloudflare Worker backend for HTTP APIs, Turnstile-backed inbox and admin flows, inbound email ingestion, WebSocket fanout, and scheduled cleanup.

Use this file to keep changes safe and repo-appropriate.

## High-Level Architecture

### Request and event entry points

- `src/client/main.tsx` boots the React app.
- `src/client/App.tsx` defines the SPA routes and top-level layout, including `/`, `/about`, `/admin`, `/link`, and `/inbox/:address`.
- `src/worker/index.ts` is the Worker entry point and exports:
  - `fetch()` for WebSocket upgrades, HTTP API handling, and asset requests
  - `email()` for Cloudflare Email Routing ingestion
  - `scheduled()` for hourly cleanup
  - `InboxWebSocket` Durable Object export
- `src/worker/router.ts` wires the Hono API routes and sets up D1 session/bookmark handling for requests.

### Main runtime flow

1. Cloudflare Email Routing delivers inbound mail to `email()`.
2. Inbox creation and admin login fetch `/api/public/config`, render Turnstile on the client, and fail closed if verification or configuration is unavailable.
3. The Worker canonicalizes plus aliases for inbox lookup, stores metadata in D1, stores bodies and attachments in R2, and rejects invalid, expired, oversized, or over-quota mail.
4. Each email record preserves the exact delivered recipient address, even when plus aliases route to the same base inbox.
5. The Worker notifies the `InboxWebSocket` Durable Object.
6. The client connects to `/ws` with a one-time ticket for real-time updates.
7. HTML email is rendered in a sandboxed iframe, outbound links are rewritten through `/link`, and remote content stays blocked by default.
8. Hourly cron cleanup removes expired temporary inboxes and associated storage.

### Storage and platform dependencies

Configured in `wrangler.jsonc`:

- `DB`: Cloudflare D1 for inbox/email metadata
- `STORAGE`: Cloudflare R2 for email bodies and attachments
- `SESSIONS`: Cloudflare KV for access tokens and WebSocket tickets
- `INBOX_WS`: Durable Object for per-inbox WebSocket fanout
- `ASSETS`: static asset binding for the built React app

Configured outside `wrangler.jsonc`, but required for auth and human-verification flows:

- `ADMIN_PASSWORD`: admin login secret; admin routes fail closed if missing or insecure
- `TURNSTILE_SITE_KEY`: public site key returned by `/api/public/config`
- `TURNSTILE_SECRET_KEY`: secret used by the Worker to verify Turnstile responses

Cloudflare Email Routing catch-all rules are configured in the Cloudflare dashboard, not in code.

## Important Directories

- `src/client/` — SPA, components, hooks, and helpers
- `src/client/lib/api/` — client HTTP helpers, `/api/public/config`, bookmarks, and session storage
- `src/client/lib/email-html/` — HTML sanitization, rewriting, and remote-content policy
- `src/shared/contracts/` — shared codecs and types
- `src/worker/api/` — Hono route registration for config, inboxes, emails, domains, and admin APIs
- `src/worker/middleware/` — auth and inbox-access middleware
- `src/worker/services/` — business logic for inbox lifecycle, storage, and Turnstile
- `src/worker/services/inbox/` — lifecycle, cleanup, domains, queries, sessions, and WebSocket tickets
- `src/worker/email-handler.ts` — inbound parsing, validation, persistence, and notification handoff
- `src/worker/security.ts` — security headers, password policy, and WebSocket origin validation
- `src/worker/durable-objects/` — real-time WebSocket fanout
- `src/worker/db/` — Drizzle schema and DB wiring
- `drizzle/` — SQL migrations and metadata
- `scripts/` — local development helpers
- `public/` — static public assets
- `waf.md` — optional Cloudflare WAF guidance

## Local Development

### Setup

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:local:init
npm run dev
```

`.dev.vars.example` currently includes:

```bash
ADMIN_PASSWORD=replace-with-a-unique-strong-password
# https://developers.cloudflare.com/turnstile/troubleshooting/testing/
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

The bundled Turnstile keys are Cloudflare's testing keys, so local inbox creation works after copying the example file. Local admin login also requires replacing the placeholder `ADMIN_PASSWORD` in `.dev.vars`, for example via `npm run admin:password`.

Assume the dev server is already running. Do not start `npm run dev` again unless the user explicitly asks or you have verified there is no relevant server already running.

### Useful commands

- `npm run dev` — start local development
- `npm run build` — build the app for production
- `npm run preview` — preview the built frontend
- `npm run generate-types` — generate Worker types from Wrangler config
- `npm run check` — generate Worker types and run TypeScript checks
- `npm run admin:password` — generate a strong admin password and matching `ADMIN_PASSWORD=...` line
- `npm run email:local` — send a test email to the local worker
- `npm run db:generate` — generate Drizzle migrations from schema changes
- `npm run db:migrate` — apply migrations to remote D1
- `npm run db:migrate:local` — apply migrations to local D1
- `npm run db:local:migrate` — alias for local D1 migrations
- `npm run db:local:reset` — reset local D1 and reapply migrations
- `npm run db:push` — quick schema push for development
- `npm run deploy` — apply remote migrations and deploy the Worker
- `npm run format` — format the repository with Prettier
- `npm run format:check` — verify formatting without writing changes

## Change Guidelines

### General

- Prefer minimal, targeted changes.
- Preserve the `client` / `worker` split and keep imports at the top of files.
- Do not introduce secrets into source control.
- Keep `src/shared/contracts/` aligned with both worker routes and client helpers.
- Prefer `@cloudflare/util-en-garde` for new validated shapes.
- Run `npm run check` when practical.

### Security-sensitive changes

- Treat inbound email content, HTML, attachments, links, headers, params, and API bodies as untrusted.
- Preserve auth, origin validation, one-time WebSocket tickets, inbox access checks, and Turnstile fail-closed behavior.
- Do not weaken CSP, iframe sandboxing, HTML sanitization, external-link rewriting, or remote-content blocking.
- Prefer fail-closed behavior for auth, admin access, WebSocket upgrades, and inbox ownership checks.
- Avoid logging secrets or sensitive message contents.
- Cleanup and lifecycle changes must not leave expired inbox access, stored content, or notifications behind.

### Backend changes

- Add or update HTTP endpoints in `src/worker/api/` and register them in `src/worker/router.ts`.
- Keep reusable logic in `src/worker/services/`, not route handlers.
- Preserve the D1 session and bookmark strategy in `src/worker/router.ts`.
- If request or response shapes change, update `src/shared/contracts/` and the matching client helpers in `src/client/lib/api/`.
- Lifecycle changes must consider D1 records, KV session or ticket state, R2 objects, and Durable Object notifications.

### Frontend changes

- Add top-level routes in `src/client/App.tsx`.
- Keep API logic centralized in `src/client/lib/api/`.
- Preserve local session persistence and D1 bookmark propagation.
- Treat `TurnstileWidget`, `src/client/lib/api/public.ts`, and `src/client/lib/email-html/` as the authoritative paths for Turnstile and email HTML safety.

### Database changes

- Update `src/worker/db/schema.ts`.
- Generate and review the matching Drizzle migration in `drizzle/`.
- Apply schema changes locally before remote migration.
- Be careful with cleanup, cascade deletes, and inbox expiration behavior.

## Repo-Specific Invariants

- `/api/*` and `/ws` requests run through the Worker before static asset handling.
- `wrangler.jsonc` configures SPA asset fallback and `run_worker_first` for `/api/*` and `/ws`.
- D1 bookmarks are propagated via the `x-d1-bookmark` header so reads can observe recent writes without forcing every request to primary.
- Inbox creation and admin login require valid Turnstile tokens and should fail closed if Turnstile keys are missing, invalid, or unavailable.
- WebSocket upgrades require a valid origin and one-time ticket.
- Admin access should fail closed when `ADMIN_PASSWORD` is missing or insecure.
- Active domains seed built-in permanent inboxes for `admin`, `postmaster`, `abuse`, and `webmaster`.
- Temporary inboxes expire and are purged by the hourly cron.
- Delete flows intentionally revoke access and remove R2 objects before deleting D1 rows; this prefers fail-closed access over perfect cross-store metadata consistency if a late D1 delete fails.
- Plus aliases route to the same base inbox, while each email record preserves the exact delivered recipient address.
- Email HTML rendering is security-sensitive: it stays sandboxed, remote resources are blocked by default, and external links are rewritten through `/link`.
- Email bodies, attachments, headers, sender metadata, and embedded links are hostile until validated or safely rendered.
- Admin authentication depends on `ADMIN_PASSWORD`; do not hardcode it.
- Admin inspection of temporary inboxes is intentionally read-only except for deleting the inbox itself.

## Quick Task Checklist

- API changes: update the worker route, shared contract, client helper, and router registration; then run `npm run check`.
- Inbox lifecycle or storage changes: consider D1, KV, R2, and Durable Object side effects; retest cleanup and real-time flows.
- Schema changes: update `src/worker/db/schema.ts`, generate and review the migration, apply locally, and re-test affected flows.
- UI or security changes: keep routes and contracts aligned; if email rendering, auth, Turnstile, WebSockets, or bookmarks change, re-check fail-closed behavior and isolation.

## Deployment Notes

- Main runtime config lives in `wrangler.jsonc`.
- The Worker serves static assets from `dist/client`.
- Production also depends on Cloudflare-side D1, R2, KV, Durable Objects, routes, and Email Routing.
- Apply DB migrations intentionally before production deploys that depend on them.

## Primary Reference Files

Start here when you need more context:

- `README.md` — quickstart and high-level overview
- `spec.md` — detailed architecture and design rationale
- `wrangler.jsonc` — bindings, assets, routes, and cron
- `package.json` — scripts
- `src/client/lib/api/` — client API helpers, bookmarks, and session storage
- `src/client/lib/email-html/` — HTML safety and link rewriting
- `src/worker/email-handler.ts` — inbound email pipeline
- `src/worker/services/inbox/` — lifecycle, cleanup, domains, sessions, and tickets
- `src/worker/security.ts` — headers, admin password policy, and WebSocket origin validation
- `src/worker/services/turnstile.ts` — Turnstile verification and fail-closed behavior
- `src/worker/router.ts` — route registration and D1 session/bookmark strategy
