# flamemail: Temporary Email System on Cloudflare

A serverless temporary email service running entirely on Cloudflare's platform. Users get disposable email addresses, receive emails in real-time via WebSocket, and view them in a React WebUI. Inbound plus aliases like `localpart+tag@domain.com` route into the base inbox while preserving the exact delivered recipient on each email.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Technology Stack](#technology-stack)
- [Data Flow](#data-flow)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Database Schema (Drizzle ORM)](#database-schema-drizzle-orm)
- [R2 Object Key Schema](#r2-object-key-schema)
- [KV Key Schema](#kv-key-schema)
- [API Design](#api-design)
- [Durable Object: InboxWebSocket](#durable-object-inboxwebsocket)
- [Multi-Domain Support](#multi-domain-support)
- [Authentication Model](#authentication-model)
- [Reserved / Permanent Inboxes](#reserved--permanent-inboxes)
- [Email HTML Rendering (Security)](#email-html-rendering-security)
- [Implementation Phases](#implementation-phases)
- [Cost Analysis](#cost-analysis)
- [Key Design Decisions & Rationale](#key-design-decisions--rationale)

---

## Architecture Overview

The system runs as a single Cloudflare Worker project that handles:

1. **HTTP requests** — REST API for inbox/email CRUD, static asset serving for the React SPA
2. **Email ingestion** — `email()` handler receives inbound mail via Cloudflare Email Routing, canonicalizes plus aliases to the base inbox, and stores the exact delivered recipient per email
3. **Real-time notifications** — Durable Objects with the Hibernation WebSocket API push new-email events to connected clients
4. **Scheduled cleanup** — `scheduled()` handler (cron) purges expired temporary inboxes

---

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Runtime | Cloudflare Workers | HTTP API, email processing, cron cleanup |
| Frontend | React SPA via Workers Static Assets | WebUI for viewing emails |
| Real-time | Durable Objects (Hibernation WebSocket API) | Push notifications for new emails |
| Metadata DB | D1 (SQLite) with Drizzle ORM | Inboxes, email metadata, domains |
| ORM | Drizzle ORM (`drizzle-orm/d1`) + D1 Sessions API | Type-safe queries plus request-scoped sequentially consistent reads |
| Body/Attachments | R2 (Object Storage) | Raw RFC 822 messages, parsed email HTML/text bodies, file attachments |
| Sessions | KV | Access tokens with auto-expiry via TTL |
| Email Ingestion | Cloudflare Email Routing (catch-all) | Receives inbound email |
| Email Parsing | `postal-mime` | MIME parsing within Worker |
| API Router | Hono | Lightweight, Workers-native, middleware support |
| Human Verification | Cloudflare Turnstile | Bot friction for inbox creation and admin login |
| Validation | `@cloudflare/util-en-garde` | Runtime codec-based request/session validation |
| Config format | `wrangler.jsonc` | Latest recommended config format |
| Build tool | Vite + `@cloudflare/vite-plugin` | Frontend build, dev server |

---

## D1 Sessions And Replication

HTTP API requests create a request-scoped D1 Session in `src/worker/router.ts` and wrap it with Drizzle before route handlers run.

- `GET` routes that are safe to serve from replicas start with `withSession("first-unconstrained")` to minimize latency when D1 read replication is enabled.
- Write and mixed read/write routes start with `withSession("first-primary")` so the first query sees the latest primary state.
- The Worker returns the latest D1 bookmark in the `x-d1-bookmark` response header, and the client replays that header on later inbox-scoped or admin-scoped HTTP requests.
- This keeps replica-backed reads sequentially consistent across requests without moving session tokens or inbox ownership state out of KV.
- The `/ws` upgrade path is handled outside Hono middleware, so its inbox lookup is explicitly primary-pinned instead of relying on bookmark propagation during the WebSocket handshake.

Read replication remains optional at deployment time; if it is disabled, the same Sessions-based code still works and simply reads from the primary.

---

## Data Flow

### 1. Inbox Creation

```
User clicks "Create Inbox"
  → Frontend fetches GET /api/config → receives { turnstileSiteKey }
  → Frontend renders Turnstile widget and user completes the challenge
  → POST /api/inboxes { domain: "example.com", ttlHours: 24 | 48 | 72, turnstileToken }
  → Worker verifies the Turnstile token against Cloudflare siteverify with expected action = "create_inbox"
  → Worker generates random local part (e.g. "a7f2x9k3m1")
  → Insert into D1 `inboxes` table with expires_at = created_at + requested TTL
  → Generate access token, store in KV with matching TTL
  → Return { address, token, ttlHours, expiresAt } + latest `x-d1-bookmark` header
  → Frontend stores accessToken in localStorage and seeds the inbox bookmark scope
```

### 1b. Inbox Extension

```
User opens an existing temporary inbox
  → POST /api/inboxes/:address/extend { ttlHours: 48 | 72 }
  → Worker validates token + inbox ownership
  → Worker computes new expires_at = created_at + requested TTL
  → Reject if requested TTL is not greater than current TTL or exceeds 72h total
  → Update D1 inbox record + refresh KV session TTL with the same token
  → Return { address, ttlHours, expiresAt } + latest `x-d1-bookmark` header
```

### 2. Email Reception

```
Email arrives at a7f2x9k3m1@example.com
  → Cloudflare Email Routing (catch-all) → email() handler
  → Parse envelope recipient from message.to
  → If local part contains `+suffix`, strip the suffix for inbox lookup only
  → Query D1: does this inbox exist and is it not expired?
     - No  → message.setReject("Address not found") or silently drop
     - Yes → Continue:
  → Reject if `message.rawSize` exceeds 10 MiB
  → Reject if the inbox already stores 100 emails
  → Parse message.raw with postal-mime
  → Reject if parsed attachment count exceeds 10
  → Insert email metadata into D1 first, including the exact delivered recipient address and deterministic R2 object keys for body + attachments
  → Store raw RFC 822 source in R2 as `.eml`
  → Store body (HTML + text) in R2 as JSON blob
  → Store attachment files in R2
  → If any R2 write fails, delete the inserted email rows and any partially written storage objects, then reject the SMTP transaction
  → Get Durable Object stub by canonical inbox address
  → Schedule `notifyNewEmail()` RPC with `ctx.waitUntil()` → DO broadcasts to connected WebSockets
  → Notification failures are logged but do not reject already-persisted email
```

### 3. WebSocket Connection (Hibernation API)

```
User opens inbox view
  → Frontend loads inbox metadata + first email page once
  → Frontend requests one-time ticket: POST /api/inboxes/:address/ws-ticket (Bearer token + latest inbox bookmark header)
  → Server creates short-lived ticket in KV (ws-ticket:{id}, 60s TTL) → returns { ticket }
  → Frontend connects: ws://host/ws?address=a7f2x9k3m1@example.com&ticket=xxx
  → Worker validates origin, consumes ticket from KV (one-time use), verifies inbox access using a primary-pinned D1 lookup
  → Routes to DO: env.INBOX_WS.getByName(address)
  → DO calls this.ctx.acceptWebSocket(server, [address])
  → DO sets auto-response: ping→pong (no wake on heartbeat)
  → DO hibernates when idle (no duration charges)
  → On new email: Email Worker → DO.notifyNewEmail(summaryPayload) RPC → DO wakes, broadcasts, hibernates
  → Frontend prepends the new summary locally and only fetches full email detail when the user opens it or no message is currently selected
```

### 5. Domain Management

```
Admin opens Admin page
  → GET /api/admin/domains
  → View all configured domains with active/disabled status and inbox counts
  → POST /api/admin/domains { domain, isActive } to add a new domain
  → PATCH /api/admin/domains/:domain { isActive } to enable or disable a domain
  → DELETE /api/admin/domains/:domain to remove a domain only when no non-reserved inboxes remain and reserved inboxes have no emails
  → Enabling or adding a domain seeds the built-in reserved permanent inboxes automatically
```

### 5b. Admin Temporary Inbox Inspection

```
Admin opens Admin page
  → GET /api/admin/temp-inboxes?page=0
  → View all active temporary inboxes with pagination and email counts
  → Click "Inspect mailbox"
  → Open /inbox/:address?admin=1 in admin inspection mode
  → Admin can browse inbox contents, attachments, and raw RFC 822 source in read-only inspection mode
  → Admin can permanently delete the active temporary mailbox via DELETE /api/inboxes/:address
  → Deletion revokes access tokens and removes associated R2 storage before deleting D1 rows
  → This ordering intentionally prefers fail-closed access over perfect cross-store metadata consistency if the final D1 delete fails
```

### 5c. Admin Login

```
Admin opens Admin page
  → Frontend fetches GET /api/config → receives { turnstileSiteKey }
  → Frontend renders Turnstile widget and user completes the challenge
  → POST /api/admin/login { password, turnstileToken }
  → Worker verifies the Turnstile token against Cloudflare siteverify with expected action = "admin_login"
  → Worker validates ADMIN_PASSWORD policy and compares the provided password
  → On success, generate admin session token in KV with 1h TTL
  → Return { token }
```

### 4. Cleanup (Scheduled)

```
Cron trigger fires every hour
  → scheduled() handler
  → Query D1: SELECT expired, non-permanent inboxes
  → For each batch:
     → Query D1 for email IDs belonging to expired inboxes
     → Revoke inbox session tokens in KV
     → List R2 objects by prefix (raw/{emailId}.eml, bodies/{emailId}.json, attachments/{emailId}/), delete them
     → DELETE FROM D1 (CASCADE removes emails + attachments rows)
  → This ordering intentionally prefers fail-closed access and storage cleanup over perfect cross-store metadata consistency if the final D1 delete fails
  → Log cleanup summary
```

---

## Project Structure

```
flamemail/
├── wrangler.jsonc                         # Worker config (JSONC format)
├── drizzle.config.ts                      # Drizzle Kit config for D1
├── package.json
├── tsconfig.json
├── vite.config.ts                         # Vite + @cloudflare/vite-plugin
├── index.html                             # Vite SPA entry
├── src/
│   ├── client/                            # React frontend
│   │   ├── main.tsx                       # React DOM entry
│   │   ├── App.tsx                        # Router + layout
│   │   ├── components/
│   │   │   ├── InboxView.tsx              # Main inbox page
│   │   │   ├── EmailList.tsx              # Email listing sidebar
│   │   │   ├── EmailDetail.tsx            # Full email viewer (HTML sandboxed, raw source view for admin)
│   │   │   ├── CreateInbox.tsx            # New inbox form (domain picker)
│   │   │   ├── AdminLogin.tsx             # Admin auth form
│   │   │   ├── TurnstileWidget.tsx        # Shared Turnstile loader/render wrapper
│   │   │   ├── ExternalLinkRedirect.tsx   # Interstitial for outbound links in email content
│   │   │   ├── Header.tsx
│   │   │   ├── Footer.tsx
│   │   │   ├── About.tsx                  # About / info page
│   │   │   ├── Toast.tsx                  # Toast notification system
│   │   │   └── admin/
│   │   │       ├── DomainManager.tsx      # Domain CRUD panel
│   │   │       ├── PermanentInboxList.tsx # Reserved inbox listing
│   │   │       └── TempInboxList.tsx      # Temporary inbox admin table
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts            # WebSocket with reconnect logic
│   │   │   └── useInbox.ts                # Inbox state management
│   │   ├── lib/
│   │   │   ├── api.ts                     # REST API client
│   │   │   ├── email-html.ts              # HTML sanitization pipeline for email rendering
│   │   │   └── time.ts                    # Date/time formatting helpers
│   │   └── styles/
│   │       └── main.css
│   └── worker/                            # Cloudflare Worker backend
│       ├── index.ts                       # Entry: exports { fetch, email, scheduled, InboxWebSocket }
│       ├── router.ts                      # Hono-based API routing
│       ├── email-handler.ts               # email() processing logic
│       ├── api/
│       │   ├── config.ts                  # Public config bootstrap (Turnstile site key)
│       │   ├── inboxes.ts                 # POST/GET/DELETE /api/inboxes
│       │   ├── emails.ts                  # GET/DELETE /api/inboxes/:addr/emails
│       │   ├── domains.ts                 # GET /api/domains
│       │   └── admin.ts                   # Admin auth, domain management, temp inbox inspection, permanent inbox listing
│       ├── db/                            # Drizzle ORM layer
│       │   ├── schema.ts                  # Table definitions
│       │   ├── relations.ts               # Drizzle relation definitions
│       │   └── index.ts                   # drizzle(env.DB) factory
│       ├── durable-objects/
│       │   └── inbox-ws.ts                # InboxWebSocket DO class (Hibernation API)
│       ├── middleware/
│       │   └── auth.ts                    # Token validation middleware
│       ├── security.ts                    # CSP, security headers, origin validation, PublicError
│       ├── logger.ts                      # Minimal structured JSON logger
│       ├── services/
│       │   ├── storage.ts                 # R2 operations for raw mail, bodies, and attachments
│       │   ├── turnstile.ts               # Cloudflare Turnstile verification
│       │   └── inbox.ts                   # Inbox + domain lifecycle (create, extend, seed, cleanup)
│       └── types.ts                       # Env bindings, validators, and shared record types
├── drizzle/                               # Generated Drizzle migrations + metadata
├── scripts/
│   ├── send-local-email.mjs               # Compose + send local test emails
│   └── reset-local-d1.mjs                 # Reset local Wrangler D1 state
└── public/
    └── .keep
```

---

## Configuration

### `wrangler.jsonc`

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "flamemail",
  "main": "src/worker/index.ts",
  "workers_dev": false,
  "compatibility_date": "2026-03-13",

  // Static assets (React frontend)
  "assets": {
    "directory": "./dist/client",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/ws"]
  },

  // D1 database
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "flamemail-db",
      "database_id": "<generated-on-create>",
      "migrations_dir": "drizzle"
    }
  ],

  // R2 bucket for raw emails, bodies, and attachments
  "r2_buckets": [
    {
      "binding": "STORAGE",
      "bucket_name": "flamemail-emails"
    }
  ],

  // KV for session tokens
  "kv_namespaces": [
    {
      "binding": "SESSIONS",
      "id": "<generated-on-create>"
    }
  ],

  // Durable Objects
  "durable_objects": {
    "bindings": [
      {
        "name": "INBOX_WS",
        "class_name": "InboxWebSocket"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["InboxWebSocket"]
    }
  ],

  // Cron: cleanup expired inboxes every hour
  "triggers": {
    "crons": ["0 * * * *"]
  },

  "observability": {
    "enabled": true
  },

  // Custom domain routing
  "routes": [
    {
      "pattern": "flamemail.devbin.tools",
      "custom_domain": true
    }
  ]
}
```

> **Note:** Email routing (catch-all → Worker) is configured per-domain in the Cloudflare dashboard, not in `wrangler.jsonc`. For each domain in the pool:
> 1. Add domain to Cloudflare (requires authoritative DNS)
> 2. Enable Email Routing
> 3. Set catch-all to "Send to Worker" → `flamemail`
> 4. MX records are configured automatically by Cloudflare Email Routing

### Environment Bindings

The Worker expects these runtime bindings:

| Binding | Purpose |
|---------|---------|
| `ADMIN_PASSWORD` | Admin session password; must be present and strong or admin access fails closed |
| `TURNSTILE_SITE_KEY` | Public Turnstile site key returned by `GET /api/config` so the SPA can render the widget |
| `TURNSTILE_SECRET_KEY` | Secret key used by the Worker to call Turnstile `siteverify` |

For local development, `.dev.vars.example` ships Cloudflare's published Turnstile test keys. They are suitable for local development and troubleshooting only; production should use a widget created for the deployed hostname.

### `drizzle.config.ts`

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/worker/db/schema.ts",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    databaseId: process.env.CLOUDFLARE_DATABASE_ID ?? "",
    token: process.env.CLOUDFLARE_D1_TOKEN ?? "",
  },
});
```

---

## Database Schema (Drizzle ORM)

### `src/worker/db/schema.ts`

```ts
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Pool of supported domains
export const domains = sqliteTable("domains", {
  id: text("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  index("idx_domains_active").on(table.isActive),
]);

// Inboxes: both temporary and permanent
export const inboxes = sqliteTable("inboxes", {
  id: text("id").primaryKey(),
  localPart: text("local_part").notNull(),
  domain: text("domain").notNull(),
  fullAddress: text("full_address").notNull().unique(),
  isPermanent: integer("is_permanent", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull().default(sql`(unixepoch() * 1000)`),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
}, (table) => [
  uniqueIndex("idx_inboxes_local_domain").on(table.localPart, table.domain),
  index("idx_inboxes_domain").on(table.domain),
  index("idx_inboxes_permanent_expires").on(table.isPermanent, table.expiresAt),
  index("idx_inboxes_permanent_created").on(table.isPermanent, table.createdAt),
  index("idx_inboxes_permanent_domain_local").on(table.isPermanent, table.domain, table.localPart),
]);

// Email metadata
export const emails = sqliteTable("emails", {
  id: text("id").primaryKey(),
  inboxId: text("inbox_id").notNull()
    .references(() => inboxes.id, { onDelete: "cascade" }),
  recipientAddress: text("recipient_address").notNull(), // exact envelope recipient, including any +alias
  fromAddress: text("from_address").notNull(),
  fromName: text("from_name"),
  subject: text("subject").default("(no subject)"),
  receivedAt: integer("received_at", { mode: "timestamp_ms" })
    .notNull().default(sql`(unixepoch() * 1000)`),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  sizeBytes: integer("size_bytes").default(0),
  hasAttachments: integer("has_attachments", { mode: "boolean" })
    .notNull().default(false),
  bodyKey: text("body_key"),  // R2 object key for body content
}, (table) => [
  index("idx_emails_inbox_received_id").on(table.inboxId, table.receivedAt, table.id),
]);

// Attachment metadata
export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  emailId: text("email_id").notNull()
    .references(() => emails.id, { onDelete: "cascade" }),
  filename: text("filename"),
  contentType: text("content_type"),
  sizeBytes: integer("size_bytes").default(0),
  storageKey: text("storage_key").notNull(),  // R2 object key
}, (table) => [
  index("idx_attachments_email").on(table.emailId),
]);
```

### `src/worker/db/relations.ts`

```ts
import { relations } from "drizzle-orm";
import { inboxes, emails, attachments } from "./schema";

export const inboxesRelations = relations(inboxes, ({ many }) => ({
  emails: many(emails),
}));

export const emailsRelations = relations(emails, ({ one, many }) => ({
  inbox: one(inboxes, { fields: [emails.inboxId], references: [inboxes.id] }),
  attachments: many(attachments),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  email: one(emails, { fields: [attachments.emailId], references: [emails.id] }),
}));
```

### `src/worker/db/index.ts`

```ts
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import * as relations from "./relations";

export type D1Client = D1Database | D1DatabaseSession;

export function createDb(d1: D1Client) {
  return drizzle(d1 as D1Database, { schema: { ...schema, ...relations } });
}

export type Database = ReturnType<typeof createDb>;
```

### Migration Workflow

```bash
# Generate migration from schema changes
npm run db:generate

# Apply generated migrations to remote D1 (production)
npm run db:migrate

# Apply generated migrations to local Wrangler D1 state
npm run db:migrate:local

# Reset local D1 state and reapply migrations from scratch
npm run db:local:reset

# Quick push during development (no migration files)
npm run db:push

# Visual DB browser
npx drizzle-kit studio
```

### Example Query Patterns

```ts
import { and, count, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { inboxes, emails, attachments } from "./schema";

// Create inbox
await db.insert(inboxes).values({
  id: nanoid(),
  localPart: "a7f2x9k3m1",
  domain: "example.com",
  fullAddress: "a7f2x9k3m1@example.com",
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
});

// List emails with stable ordering for mailbox view
const results = await db.query.emails.findMany({
  where: eq(emails.inboxId, inboxId),
  orderBy: [desc(emails.receivedAt), desc(emails.id)],
  limit: 20,
  offset: page * 20,
});

// Optional count for explicit pagination UI, skipped on the hot path by default
const totalRows = await db
  .select({ total: count() })
  .from(emails)
  .where(eq(emails.inboxId, inboxId));

// Get email with attachments (scoped to the current inbox)
const email = await db.query.emails.findFirst({
  where: and(eq(emails.id, emailId), eq(emails.inboxId, inboxId)),
  with: { attachments: true },
});

// Download one attachment without loading the entire attachment set first
const attachment = await db
  .select({
    id: attachments.id,
    filename: attachments.filename,
    contentType: attachments.contentType,
    storageKey: attachments.storageKey,
  })
  .from(attachments)
  .innerJoin(emails, eq(attachments.emailId, emails.id))
  .where(and(
    eq(attachments.id, attachmentId),
    eq(emails.id, emailId),
    eq(emails.inboxId, inboxId),
  ))
  .limit(1);

// Batch insert: email + attachments atomically
await db.batch([
  db.insert(emails).values({ id: emailId, inboxId, recipientAddress, fromAddress, subject, bodyKey, ... }),
  db.insert(attachments).values({ id: attId, emailId, filename, storageKey, ... }),
]);

// List active temporary inboxes for admin
const [items, totalRows] = await Promise.all([
  db.query.inboxes.findMany({
    where: and(eq(inboxes.isPermanent, false), gt(inboxes.expiresAt, new Date())),
    orderBy: [desc(inboxes.createdAt)],
    limit: pageSize,
    offset: currentPage * pageSize,
  }),
  db
    .select({ total: count() })
    .from(inboxes)
    .where(and(eq(inboxes.isPermanent, false), gt(inboxes.expiresAt, new Date()))),
]);

// Cleanup expired inboxes in bounded batches after deleting R2 objects
const expiredInboxes = await db.query.inboxes.findMany({
  where: and(eq(inboxes.isPermanent, false), lt(inboxes.expiresAt, new Date())),
  orderBy: [asc(inboxes.expiresAt), asc(inboxes.id)],
  limit: EXPIRED_INBOX_CLEANUP_BATCH_SIZE,
});

const expiredInboxIds = expiredInboxes.map((inbox) => inbox.id);
const emailRows = await db
  .select({ id: emails.id })
  .from(emails)
  .where(inArray(emails.inboxId, expiredInboxIds));

await db.delete(inboxes).where(inArray(inboxes.id, expiredInboxIds));
```

---

## R2 Object Key Schema

```
raw/{email_uuid}.eml                                 → full raw RFC 822 source
bodies/{email_uuid}.json                              → { "text": "...", "html": "..." }
attachments/{email_uuid}/{attachment_uuid}/{filename}  → raw file bytes
```

---

## KV Key Schema

```
token:{access_token}       →  { "address": "abc@domain.com", "type": "user" }  or  { "type": "admin" }
                               TTL: matches inbox expiry (user) or 1h (admin sessions)

ws-ticket:{ticket_id}     →  { "address": "abc@domain.com", "session": SessionRecord }
                               TTL: 60 seconds (one-time use, consumed on WebSocket upgrade)
```

HTTP bookmark state is not stored in KV. The client keeps per-scope D1 bookmarks locally and sends them back in the `x-d1-bookmark` header.

---

## API Design

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/domains` | None | List available domains |
| `GET` | `/api/config` | None | Return public runtime config for the SPA, currently `{ turnstileSiteKey }` |
| `POST` | `/api/inboxes` | Turnstile | Create temp inbox → `{ address, token, ttlHours, expiresAt }` |
| `GET` | `/api/inboxes/:address` | Token | Get inbox info |
| `POST` | `/api/inboxes/:address/extend` | Token | Extend a temp inbox to 48h or 72h total lifetime |
| `DELETE` | `/api/inboxes/:address` | Token | Delete inbox + all emails (owners can delete their inbox; admins can delete active temporary inboxes while inspecting them) |
| `POST` | `/api/inboxes/:address/ws-ticket` | Token | Issue a one-time WebSocket upgrade ticket (60s TTL) |
| `GET` | `/api/inboxes/:address/emails` | Token | List emails (paginated; `includeTotal=1` opt-in for count) |
| `GET` | `/api/inboxes/:address/emails/:id` | Token | Get full email (fetches body from R2) |
| `DELETE` | `/api/inboxes/:address/emails/:id` | Token | Delete single email |
| `GET` | `/api/inboxes/:address/emails/:id/attachments/:attId` | Token | Download attachment from R2 |
| `GET` | `/api/inboxes/:address/emails/:id/raw` | Admin token scoped to inbox access | View stored raw RFC 822 source from R2 |
| `POST` | `/api/admin/login` | Password + Turnstile | Admin login → `{ token }` |
| `GET` | `/api/admin/domains` | Admin token | List all domains with active status and inbox counts |
| `GET` | `/api/admin/temp-inboxes?page=0` | Admin token | List active temporary inboxes with pagination and email counts |
| `POST` | `/api/admin/domains` | Admin token | Add a new domain and optionally start it active |
| `PATCH` | `/api/admin/domains/:domain` | Admin token | Enable or disable a domain |
| `DELETE` | `/api/admin/domains/:domain` | Admin token | Delete a domain only if every remaining inbox is a reserved permanent inbox and none of those inboxes have emails |
| `GET` | `/api/admin/inboxes` | Admin token | List seeded permanent inboxes |
| `WS` | `/ws?address=...&ticket=...` | Ticket | WebSocket for real-time notifications (ticket from ws-ticket endpoint) |

### D1 Bookmark Header

- Request header: `x-d1-bookmark`
- Response header: `x-d1-bookmark`
- Scope: replayed by the client per inbox and for the admin console
- Purpose: lets later HTTP requests continue from a database version that is at least as fresh as the prior response, which is required for safe D1 read replication

### Request/Response Examples

**Public Config:**
```
GET /api/config

→ 200 OK
{
  "turnstileSiteKey": "0x4AAAA..."
}
```

**Create Inbox:**
```
POST /api/inboxes
Content-Type: application/json

{ "domain": "example.com", "ttlHours": 24, "turnstileToken": "0.turnstile-token" }

→ 201 Created
{
  "address": "a7f2x9k3m1@example.com",
  "token": "tok_abc123...",
  "ttlHours": 24,
  "expiresAt": "2026-03-15T12:00:00Z"
}
```

**Extend Inbox:**
```
POST /api/inboxes/a7f2x9k3m1@example.com/extend
Authorization: Bearer tok_abc123...
Content-Type: application/json

{ "ttlHours": 72 }

→ 200 OK
{
  "address": "a7f2x9k3m1@example.com",
  "ttlHours": 72,
  "expiresAt": "2026-03-17T12:00:00Z"
}
```

**Admin Login:**
```
POST /api/admin/login
Content-Type: application/json

{ "password": "correct horse battery staple ...", "turnstileToken": "0.turnstile-token" }

→ 200 OK
{
  "token": "tok_admin_abc123..."
}
```

**Admin Temporary Inboxes:**
```
GET /api/admin/temp-inboxes?page=0
Authorization: Bearer tok_admin...

→ 200 OK
{
  "inboxes": [
    {
      "address": "a7f2x9k3m1@example.com",
      "domain": "example.com",
      "createdAt": "2026-03-14T12:00:00Z",
      "expiresAt": "2026-03-16T12:00:00Z",
      "ttlHours": 48,
      "emailCount": 3
    }
  ],
  "page": 0,
  "pageSize": 20,
  "total": 1
}
```

**List Emails:**
```
GET /api/inboxes/a7f2x9k3m1@example.com/emails?page=0
Authorization: Bearer tok_abc123...

→ 200 OK
{
  "emails": [
    {
      "id": "em_xyz",
      "recipientAddress": "a7f2x9k3m1+news@example.com",
      "fromAddress": "sender@other.com",
      "fromName": "Sender",
      "subject": "Hello",
      "receivedAt": "2026-03-14T10:30:00Z",
      "isRead": false,
      "hasAttachments": true,
      "sizeBytes": 18234
    }
  ],
  "total": null,
  "page": 0
}
```

`includeTotal=1` can be added when the caller explicitly needs a count for pagination or admin-style UIs.

**WebSocket Messages (server → client):**
```json
{
  "type": "new_email",
  "email": {
    "id": "em_xyz",
    "recipientAddress": "a7f2x9k3m1+news@example.com",
    "fromAddress": "sender@other.com",
    "fromName": "Sender",
    "subject": "Hello",
    "receivedAt": "2026-03-14T10:30:00Z",
    "isRead": false,
    "hasAttachments": true,
    "sizeBytes": 18234
  }
}
```

---

## Durable Object: InboxWebSocket

The `InboxWebSocket` Durable Object manages WebSocket connections per inbox address using the Hibernation API for cost efficiency.

```ts
import { DurableObject } from "cloudflare:workers";
import type { NewEmailNotification } from "../types";

export class InboxWebSocket extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async notifyNewEmail(payload: NewEmailNotification): Promise<void> {
    this.broadcast(JSON.stringify({ type: "new_email", ...payload }));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const url = new URL(request.url);
      const address = url.searchParams.get("address") ?? "unknown";

      this.ctx.acceptWebSocket(server, [address]);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Expected WebSocket upgrade", { status: 400 });
  }

  private broadcast(message: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      ws.send(message);
    }
  }

  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string" && message === "ping") {
      return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    ws.close(1011, "WebSocket error");
  }
}
```

### Cost Efficiency via Hibernation

| Aspect | Without Hibernation | With Hibernation |
|--------|-------------------|-----------------|
| Duration billing | Charged entire time WebSocket is connected | Only while actively executing JS |
| Idle connections | DO stays in memory | DO evicted, **no charges** |
| Ping/pong | Manual handling keeps DO awake | Auto at edge, **does not wake DO** |
| 100 DOs × 50 conns × 8h/day | ~$138/month | ~$10/month |

The `setWebSocketAutoResponse` for ping/pong is critical — it keeps clients connected through the Cloudflare edge without waking the Durable Object, eliminating duration charges for idle connections.

---

## Multi-Domain Support

The domain pool is managed in the D1 `domains` table. The system supports **apex domains** (e.g. `user@example.com`, not subdomains).

### Setup per Domain

For each domain in the pool:

1. **Add domain to Cloudflare** — requires Cloudflare as authoritative nameserver (full DNS setup)
2. **Enable Email Routing** — in dashboard: Email > Email Routing
3. **Set catch-all** — Action: "Send to Worker" → select `flamemail`
4. **MX records** — configured automatically by Cloudflare Email Routing
5. **Insert into D1** — add to `domains` table with `isActive = true`

### Runtime Administration

- Admins can add domains directly from the WebUI
- Domains can be **disabled** without deleting their historical inboxes or email data
- Disabled domains disappear from `GET /api/domains` and inbound email is rejected for them
- Domains can only be **deleted** when no non-reserved inboxes reference them and reserved permanent inboxes have no emails; otherwise the API returns a conflict and instructs the admin to disable them instead
- Adding or re-enabling a domain automatically seeds the built-in reserved permanent inboxes
- The shipped product does not currently expose arbitrary permanent inbox creation or reservation from the UI or API

### Runtime Handling

The `email()` handler extracts the domain from `message.to`:

```ts
const [localPart, domain] = message.to.split("@");
```

It validates the domain against the `domains` table and the local part against the `inboxes` table before processing.

The frontend fetches `GET /api/domains` to present domain choices during inbox creation.

---

## Authentication Model

| Inbox Type | Auth Mechanism | Token Storage | Lifetime |
|-----------|---------------|---------------|----------|
| Temporary | Random access token issued at creation | KV with TTL matching inbox expiry | 24h, 48h, or 72h |
| Permanent (admin) | Admin password → session token | KV with 1h TTL | 1h per session |

Anonymous write flows use Turnstile in addition to session auth. The client obtains the public site key from `GET /api/config`, renders the widget, and submits the returned token with the form. The Worker verifies the token server-side with Cloudflare and rejects missing, invalid, mismatched-action, or hostname-mismatched tokens.

### Temporary Inboxes

- Token generated as `nanoid` (uses `crypto.getRandomValues()` under the hood) on inbox creation, prefixed with `tok_`
- `POST /api/inboxes` requires a Turnstile token with expected action `create_inbox` before any D1 or KV state is created
- Stored in KV: key = `token:{uuid}`, value = `{ address, type: "user" }`
- KV TTL matches inbox expiry (24h, 48h, or 72h depending on the selected lifetime)
- Frontend stores token in `localStorage`
- All API calls include `Authorization: Bearer <token>` header
- Extending an inbox refreshes the same token's TTL instead of issuing a new token
- Temporary inboxes cannot exceed **72 total hours** from creation time

### Admin Access

- Admin password stored as a Worker secret (`ADMIN_PASSWORD` environment variable)
- Admin login and admin APIs fail closed if `ADMIN_PASSWORD` is missing, blank, a known placeholder, or too weak
- A valid `ADMIN_PASSWORD` must be at least 16 characters and include at least 3 of 4 character classes: lowercase, uppercase, number, and symbol
- `POST /api/admin/login` requires a Turnstile token with expected action `admin_login`
- `POST /api/admin/login` with `{ password, turnstileToken }` → verifies Turnstile, validates the password, and returns a session token
- Admin token stored in KV: `token:{uuid}` → `{ type: "admin" }`
- Admin tokens grant access to all permanent inboxes and active temporary inboxes
- Temporary inbox inspection from the admin UI allows viewing messages, attachments, and stored raw RFC 822 source, but admins cannot extend the mailbox or delete individual emails
- Admins can **permanently delete** an active temporary inbox while inspecting it via `DELETE /api/inboxes/:address`, which removes the inbox, all emails, and associated R2 storage

### Auth Middleware

All API endpoints except `GET /api/domains`, `GET /api/config`, `POST /api/inboxes`, and `POST /api/admin/login` require a valid `Authorization: Bearer <token>` header. The two public `POST` routes still require Turnstile verification before the Worker creates state or evaluates admin credentials. The middleware:

1. Extracts token from header
2. Looks up `token:{value}` in KV
3. Verifies the token grants access to the requested inbox (user tokens are scoped to their inbox; admin tokens can inspect permanent and active temporary inboxes)
4. Rejects with 401/403 on failure

Session and route access remain keyed to the canonical inbox address (for example, `user@example.com`). Plus aliases are an inbound delivery feature only; the exact delivered alias is preserved per email via `recipientAddress` and rendered in the UI.

---

## Reserved / Permanent Inboxes

flamemail currently ships with a fixed reserved set of permanent inboxes that are seeded when a domain is added or re-enabled through the admin API:

```ts
// Seeded by the admin domain-management flows
const RESERVED_ADDRESSES = ["admin", "postmaster", "abuse", "webmaster"];

for (const domain of activeDomains) {
  for (const local of RESERVED_ADDRESSES) {
    await db.insert(inboxes).values({
      id: nanoid(),
      localPart: local,
      domain: domain,
      fullAddress: `${local}@${domain}`,
      isPermanent: true,
      expiresAt: null,  // never expires
    }).onConflictDoNothing();
  }
}
```

Permanent inboxes:

- **Never expire** — `expiresAt` is null, excluded from cleanup
- **Require admin authentication** to access
- **Support deletion** of individual emails by the admin
- **Same WebSocket notification flow** as temporary inboxes
- **Cannot be deleted** via the API (only their emails can be deleted)
- **Are limited to the built-in reserved set above** — arbitrary permanent inbox creation is not currently exposed in the shipped product

---

## Email HTML Rendering (Security)

Email HTML bodies are pre-processed through a client-side DOMParser-based sanitization pipeline (`email-html.ts`) and rendered in a maximally sandboxed `<iframe>`:

```html
<iframe
  sandbox="allow-popups allow-popups-to-escape-sandbox"
  srcdoc={buildSrcDoc(preparedHtml)}
  referrerPolicy="no-referrer"
/>
```

### Sanitization Pipeline (`email-html.ts`)

1. **Blocked tags removed** — `<script>`, `<object>`, `<embed>`, `<iframe>`, `<form>`, `<input>`, `<svg>`, `<canvas>`, `<meta>`, `<link>`, `<base>`, and others
2. **Event handlers stripped** — all `on*` attributes and `srcdoc` removed
3. **URL sanitization** — `javascript:`, `vbscript:`, `file:`, dangerous `data:` URIs blocked from all URL attributes
4. **CSS sanitization** — `expression()`, `@import`, and remote `url()` references blocked; `behavior` properties stripped
5. **Remote content blocked by default** — remote images replaced with placeholders; user can opt-in to load remote content per email
6. **Links hardened** — all `<a>` tags get `target="_blank" rel="noopener noreferrer nofollow"`
7. **`<style>` tags sanitized** — both `<head>` and inline `<body>` stylesheets are processed through the CSS sanitizer
8. **`sandbox="allow-popups allow-popups-to-escape-sandbox"`** — keeps scripts, forms, and same-origin access disabled while still allowing links to open in a separate browsing context
9. **`referrerPolicy="no-referrer"`** — prevents tracking pixel leaks

---

## Implementation Phases

| Phase | Tasks | Priority |
|-------|-------|----------|
| **1. Project Setup** | Init project with C3/Vite, configure `wrangler.jsonc`, create D1 database, R2 bucket, KV namespace, install Drizzle + Hono | Foundation |
| **2. Database Layer** | Define Drizzle schema, generate initial migration, set up `createDb` factory, seed permanent inboxes | Foundation |
| **3. Email Ingestion** | Implement `email()` handler, MIME parsing with `postal-mime`, early size / quota / attachment rejection, D1-first persistence, raw/body/attachment storage in R2, and best-effort websocket fanout | Core |
| **4. REST API** | Build Hono routes for inbox CRUD, inbox extension, email listing/detail, attachment download, auth middleware | Core |
| **5. WebSocket Notifications** | Implement `InboxWebSocket` Durable Object with Hibernation API + RPC notifications, connect email handler → DO notification, client-side hook | Core |
| **6. React Frontend** | Inbox creation with domain picker + TTL selection, email list, email detail viewer, WebSocket integration, admin login | UI |
| **7. Cleanup & Admin** | `scheduled()` handler for TTL cleanup (D1 + R2), admin inbox management, domain pool management, permanent inbox seeding | Operations |
| **8. Multi-Domain** | Domain pool management API, per-domain Email Routing setup documentation | Extension |
| **9. Hardening** | Turnstile, rate limiting, structured logging, input validation, error handling, observability, security headers, CORS | Polish |

---

## Cost Analysis

### Base Cost

| Item | Cost |
|------|------|
| Workers Paid plan (required for Durable Objects) | **$5.00/month** |

### Included Allowances (Workers Paid Plan, $5/month)

| Resource | Included Free | Overage Rate |
|----------|--------------|--------------|
| Worker requests | 10M/month | $0.30/million |
| D1 rows read | 25B/month | $0.001/million |
| D1 rows written | 50M/month | $1.00/million |
| D1 storage | 5 GB | $0.75/GB-month |
| R2 storage | 10 GB/month | $0.015/GB-month |
| R2 Class A ops (writes) | 1M/month | $4.50/million |
| R2 Class B ops (reads) | 10M/month | $0.36/million |
| R2 egress | Unlimited | $0 |
| KV reads | 10M/month | $0.50/million |
| KV writes | 1M/month | $5.00/million |
| KV storage | 1 GB | $0.50/GB-month |
| DO requests | 1M/month | $0.15/million |
| DO duration | 400K GB-s/month | $12.50/million GB-s |
| Email Routing | Unlimited | $0 |
| Static Assets serving | Unlimited | $0 |

### Usage Scenarios

#### Light: ~100 emails/day (3K/month)

| Resource | Usage | Cost |
|----------|-------|------|
| Worker invocations | ~15K | $0 |
| D1 writes | ~10K | $0 |
| D1 reads | ~50K | $0 |
| D1 storage | ~10 MB | $0 |
| R2 writes | ~3K | $0 |
| R2 reads | ~10K | $0 |
| R2 storage | ~50 MB | $0 |
| KV ops | ~5K | $0 |
| DO (hibernating) | ~0.01 GB-s | $0 |
| **Total** | | **$5.00/month** |

#### Moderate: ~1,000 emails/day (30K/month)

| Resource | Usage | Cost |
|----------|-------|------|
| Worker invocations | ~165K | $0 |
| D1 writes | ~100K | $0 |
| D1 reads | ~500K | $0 |
| D1 storage | ~100 MB | $0 |
| R2 writes | ~30K | $0 |
| R2 reads | ~100K | $0 |
| R2 storage | ~500 MB | $0 |
| KV ops | ~50K | $0 |
| DO (hibernating) | ~0.5 GB-s | $0 |
| **Total** | | **$5.00/month** |

#### Heavy: ~10,000 emails/day (300K/month)

| Resource | Usage | Cost |
|----------|-------|------|
| Worker invocations | ~1.5M | $0 |
| D1 writes | ~1M | $0 |
| D1 reads | ~5M | $0 |
| D1 storage | ~1 GB | $0 |
| R2 writes | ~300K | $0 |
| R2 reads | ~1M | $0 |
| R2 storage | ~3 GB | $0 |
| KV ops | ~500K | $0 |
| DO (hibernating) | ~5 GB-s | $0 |
| **Total** | | **$5.00/month** |

#### Extreme: ~100,000 emails/day (3M/month)

| Resource | Usage | Cost |
|----------|-------|------|
| Worker invocations | ~15M | $1.50 |
| D1 writes | ~10M | $0 |
| D1 reads | ~50M | $0 |
| D1 storage | ~5 GB | $0 |
| R2 writes | ~3M | $9.00 |
| R2 reads | ~10M | $0 |
| R2 storage | ~10 GB | $0 |
| KV ops | ~5M | $0 |
| DO (hibernating) | ~50 GB-s | $0 |
| **Total** | | **~$15.50/month** |

### Cost Summary

| Daily Emails | Monthly Cost | Notes |
|-------------|-------------|-------|
| 100 | **$5.00** | Well within all included tiers |
| 1,000 | **$5.00** | Still within all included tiers |
| 10,000 | **$5.00** | Still within all included tiers |
| 100,000 | **~$15.50** | Minor overages on Workers + R2 writes |
| 1,000,000 | **~$110** | Significant R2 write costs; consider batching |

> The Hibernation WebSocket API is the key cost saver. Without it, 50 persistent WebSocket connections 24/7 would cost ~$70+/month in Durable Object duration charges alone. With hibernation, the same scenario costs **pennies**.

---

## Key Design Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| **D1 for metadata, R2 for bodies** | D1 rows capped at 2MB; email bodies can be large. Keeping D1 lean enables fast queries and low read costs. R2 has free egress and lifecycle rules. |
| **Drizzle ORM** | Type-safe queries with zero runtime overhead. `db.batch()` maps to D1's batch API for atomic operations. Migration tooling with `drizzle-kit`. |
| **KV for sessions (not D1)** | Session lookups are read-heavy, latency-sensitive, and globally distributed. KV's edge caching is ideal. Built-in TTL handles auto-expiry. |
| **One DO per inbox address** | Clean isolation. The DO only wakes when that specific inbox gets mail or has a connected client. Hibernation makes idle DOs free. |
| **Workers Static Assets (not Pages)** | Cloudflare's recommended approach for new projects. Single deploy for frontend + backend. Free, unlimited static serving. |
| **Hono as API router** | Lightweight, Workers-native, middleware support, TypeScript-first. Better than itty-router for structured APIs with middleware chains. |
| **Cron for cleanup (not DO alarms)** | Simpler to manage centrally. One cron job scans all expired inboxes vs. thousands of individual DO alarms. |
| **`wrangler.jsonc` (not `.toml`)** | Latest recommended format as of Wrangler v3.91+. JSON schema support enables IDE autocomplete. Some newer features are JSONC-only. |
| **`postal-mime` for parsing** | Purpose-built for Workers environments. Lightweight, handles MIME multipart, attachments, and character encoding. |
| **`nanoid` for IDs (not UUIDs)** | Shorter, URL-safe, higher entropy per character. Uses `crypto.getRandomValues()` under the hood for cryptographic randomness. Good fit for inbox local parts, database primary keys, and access tokens. |
| **Apex domain support** | Cloudflare Email Routing works on apex domains directly. No subdomain requirement (e.g. `user@example.com` works, not just `user@mail.example.com`). |

---

## Cloudflare Email Worker API Reference

### `email()` Handler

```ts
export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    // message.from     — envelope sender
    // message.to       — envelope recipient
    // message.headers  — Headers object (Web API)
    // message.raw      — ReadableStream of full RFC 822 message
    // message.rawSize  — size in bytes

    // Actions:
    message.setReject("reason");                    // reject with SMTP error
    await message.forward("dest@example.com");      // forward to verified address
    await message.reply(new EmailMessage(...));      // reply to sender
  },
};
```

### Parsing with `postal-mime`

```ts
import PostalMime from "postal-mime";

const rawEmail = await new Response(message.raw).arrayBuffer();
const parser = new PostalMime();
const parsed = await parser.parse(rawEmail);

// parsed.from         — { name, address }
// parsed.to           — [{ name, address }]
// parsed.subject      — string
// parsed.text         — plain text body
// parsed.html         — HTML body
// parsed.attachments  — [{ filename, mimeType, content (ArrayBuffer) }]
```

### Limits

| Limit | Value |
|-------|-------|
| Cloudflare Email Routing max message size | 25 MiB |
| Application max accepted message size | 10 MiB |
| Application max attachments per message | 10 |
| Application max stored emails per inbox | 100 |
| Rules per zone | 200 |
| Worker CPU time (paid) | 30s per invocation |

---

## Durable Objects Pricing Detail

| Metric | Included (Paid Plan) | Overage |
|--------|---------------------|---------|
| Requests (incl. WS messages at 20:1 ratio) | 1M/month | $0.15/million |
| Duration (128MB per DO) | 400,000 GB-s/month | $12.50/million GB-s |
| DO SQLite storage: rows read | 25B/month | $0.001/million |
| DO SQLite storage: rows written | 50M/month | $1.00/million |
| DO SQLite storage: stored data | 5 GB | $0.20/GB-month |

> WebSocket messages use a **20:1 billing ratio**: 100 incoming WebSocket messages count as 5 billed requests. Outgoing messages are free. Auto-response messages (ping/pong) incur no duration charges.
