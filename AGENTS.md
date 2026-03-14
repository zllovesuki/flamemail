# AGENTS.md

## Purpose

This repository contains **Flamemail**, a disposable email service that runs on Cloudflare's edge. It has a React SPA frontend and a Cloudflare Worker backend that handles HTTP APIs, inbound email ingestion, WebSocket fanout, and scheduled cleanup.

Use this file as the primary guide for making safe, repo-appropriate changes.

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
2. The Worker parses email content, persists metadata in D1, stores raw/body/attachment content in R2, and rejects invalid, expired, oversized, or over-quota deliveries.
3. The Worker notifies the `InboxWebSocket` Durable Object.
4. The React client connects to `/ws` using a one-time ticket and receives real-time updates.
5. The client renders email HTML in a sandboxed iframe, rewrites outbound links through `/link`, and blocks remote content unless the user opts in.
6. Hourly cron cleanup removes expired temporary inboxes and associated storage.

### Storage and platform dependencies

Configured in `wrangler.jsonc`:

- `DB`: Cloudflare D1 for inbox/email metadata
- `STORAGE`: Cloudflare R2 for email bodies and attachments
- `SESSIONS`: Cloudflare KV for access tokens and WebSocket tickets
- `INBOX_WS`: Durable Object for per-inbox WebSocket fanout
- `ASSETS`: static asset binding for the built React app

Cloudflare Email Routing catch-all rules are configured in the Cloudflare dashboard, not in code.

## Important Directories

- `src/client/`
  - React SPA, UI components, hooks, and API helpers
- `src/shared/contracts/`
  - Shared request/response/session codecs and types used by both client and worker
- `src/worker/api/`
  - Hono route registration for inboxes, emails, domains, and admin APIs
- `src/worker/middleware/`
  - Auth and inbox-access middleware for bearer tokens, admin gating, and expiry checks
- `src/worker/services/`
  - Core business logic for inbox lifecycle and storage operations
- `src/worker/durable-objects/`
  - Real-time WebSocket Durable Object implementation
- `src/worker/db/`
  - Drizzle schema, relations, and DB wiring
- `drizzle/`
  - Generated SQL migrations and Drizzle metadata
- `scripts/`
  - Local development helpers for D1 reset and test email sending
- `public/`
  - Static public assets

## Local Development

### Setup

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:local:init
npm run dev
```

`.dev.vars.example` currently requires:

```bash
ADMIN_PASSWORD=replace-with-a-unique-strong-password
```

### Useful commands

- `npm run dev` — start local development
- `npm run build` — build the frontend bundle
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

## Change Guidelines

### General

- Prefer minimal, targeted changes.
- Preserve the existing separation between `client` and `worker` code.
- Keep imports at the top of files.
- Do not introduce secrets into source control.
- Keep shared API/session contracts in `src/shared/contracts/` aligned with both client and worker consumers.
- When introducing a new custom type or validation shape, prefer `@cloudflare/util-en-garde` so runtime validation and inferred types stay aligned.
- Validate changes with `npm run check` when practical.

### Security-sensitive changes

- Treat inbound email content, rendered HTML, attachments, links, request headers, query params, and API bodies as untrusted input.
- Preserve existing origin validation, token validation, one-time WebSocket ticket consumption, and inbox access checks; do not bypass them for convenience.
- Do not weaken CSP, security headers, iframe sandboxing, HTML sanitization, external-link rewriting, or remote-content blocking behavior around email rendering without a clear, reviewed reason.
- Prefer fail-closed behavior for auth, admin access, WebSocket upgrades, and inbox ownership checks.
- Avoid logging secrets or sensitive user data such as access tokens, WebSocket tickets, admin credentials, raw email bodies, or attachment contents.
- When changing cleanup or lifecycle logic, ensure expired inboxes cannot retain access, leak stored content, or continue receiving notifications.

### Backend changes

- Add or update HTTP endpoints in `src/worker/api/` and ensure they are registered via `src/worker/router.ts`.
- Keep the Worker entry responsibilities in `src/worker/index.ts` limited to request/event routing and top-level coordination.
- Put reusable business logic in `src/worker/services/` instead of route handlers when possible.
- Preserve the current D1 session strategy in `src/worker/router.ts`: replica-friendly reads may use bookmarked or unconstrained sessions, while writes should continue to use primary sessions.
- If an endpoint changes request or response shapes, update the matching codec in `src/shared/contracts/` and any client API helpers in `src/client/lib/api.ts`.
- For new Worker-side custom request/response/session/data shapes, define them with `@cloudflare/util-en-garde` rather than standalone TypeScript-only types when practical.
- Any change involving inbox lifecycle should account for consistency across:
  - D1 records
  - KV session or ticket state
  - R2 stored bodies/attachments
  - Durable Object notifications

### Frontend changes

- Add top-level routes in `src/client/App.tsx`.
- Keep API-calling logic centralized in `src/client/lib/` when possible.
- Preserve the real-time inbox flow, local session persistence behavior, and D1 bookmark propagation in `src/client/lib/api.ts`.
- Treat `src/client/lib/email-html.ts`, `src/client/components/EmailDetail.tsx`, and `src/client/components/ExternalLinkRedirect.tsx` as the authoritative path for HTML email safety and outbound-link handling.

### Database changes

- Update schema in `src/worker/db/schema.ts`.
- Generate a migration in `drizzle/` after schema changes.
- Review the generated SQL and Drizzle metadata before relying on it.
- Apply schema changes locally before considering remote migration.
- Prefer migration-backed schema changes over ad hoc manual DB edits.
- Be careful with changes that affect cleanup, cascade deletes, or inbox expiration.

## Repo-Specific Invariants

- `/api/*` and `/ws` requests run through the Worker before static asset handling.
- `wrangler.jsonc` configures SPA asset fallback and `run_worker_first` for `/api/*` and `/ws`.
- D1 bookmarks are propagated via the `x-d1-bookmark` header so reads can observe recent writes without forcing every request to primary.
- WebSocket upgrades require a valid origin and one-time ticket.
- Admin access should fail closed when `ADMIN_PASSWORD` is missing or insecure.
- Temporary inboxes expire and are purged by the hourly cron.
- Delete flows intentionally revoke access and remove R2 objects before deleting D1 rows; this prefers fail-closed access over perfect cross-store metadata consistency if a late D1 delete fails.
- Email HTML rendering is treated as a security-sensitive path.
- Email HTML is rendered in a sandboxed iframe and remote resources are blocked by default until explicitly allowed by the user.
- External links from email HTML are rewritten through `/link` before navigation.
- Email bodies, attachments, headers, sender metadata, and embedded links are hostile until validated or safely rendered.
- Admin authentication depends on `ADMIN_PASSWORD`; do not hardcode it.

## Recommended Workflow For Common Tasks

### Adding or changing an API

1. Update the appropriate file in `src/worker/api/`.
2. Update `src/shared/contracts/` for any request/response/session shape changes.
3. Move non-trivial logic into `src/worker/services/` if needed.
4. Confirm registration in `src/worker/router.ts`.
5. Update any matching client helpers in `src/client/lib/api.ts`.
6. Run `npm run check`.

### Changing persistence or inbox lifecycle

1. Update schema and service logic together.
2. Generate Drizzle migrations if schema changed.
3. Consider D1, KV, R2, and Durable Object side effects.
4. Re-test cleanup and real-time flows.

### Changing the DB schema

1. Update `src/worker/db/schema.ts` and any related query or type usage in `src/worker/services/`, `src/worker/api/`, and `src/worker/types.ts`.
2. Generate a migration with `npm run db:generate`.
3. Review the generated files in `drizzle/` to confirm indexes, constraints, defaults, and destructive operations match intent.
4. Apply the migration to local D1 with `npm run db:migrate:local`, or use `npm run db:local:reset` if you need a clean local state.
5. Re-test the affected flows end-to-end, especially lifecycle behavior, cascade deletes, cleanup, and any admin operations that rely on the changed schema.
6. Run `npm run check`.
7. Only apply the migration remotely with `npm run db:migrate` when the schema and migration have been intentionally reviewed.

### Changing UI behavior

1. Update the relevant component or hook in `src/client/`.
2. Keep route definitions in `src/client/App.tsx` aligned.
3. Verify the API contract still matches the worker responses.
4. If the change touches email rendering or links, re-check sanitization, iframe sandboxing, and `/link` redirect behavior.

### Changing security-sensitive behavior

1. Identify whether the change touches auth, admin flows, WebSocket admission, email rendering, attachment handling, redirects, D1 consistency/bookmarking, or cleanup.
2. Preserve or strengthen validation, origin checks, token scope checks, HTML isolation, and bookmark propagation behavior.
3. Confirm logs and errors do not expose secrets or sensitive message content.
4. Run `npm run check` and review the affected flow for fail-open behavior.

## Deployment Notes

- Main runtime config lives in `wrangler.jsonc`.
- The Worker serves static assets from `dist/client`.
- Deployment also depends on Cloudflare-side resources existing for D1, R2, KV, Durable Objects, routes, and Email Routing.
- Before production deploys involving DB changes, ensure migrations are applied intentionally.

## Primary Reference Files

Start here when you need more context:

- `README.md` — quickstart, features, and high-level structure
- `spec.md` — detailed architecture, flows, and design rationale
- `wrangler.jsonc` — runtime bindings and cron/routes
- `package.json` — supported scripts
- `src/client/lib/api.ts` — client API calls, local session persistence, and D1 bookmark handling
- `src/client/lib/email-html.ts` — HTML sanitization and external-link rewriting for email rendering
- `src/worker/middleware/auth.ts` — auth, admin gating, and inbox access enforcement
- `src/worker/router.ts` — route registration and D1 session/bookmark strategy
