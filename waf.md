# Cloudflare WAF Recommendation for Flamemail

## Overview

Flamemail has a small, well-defined HTTP surface that maps cleanly to Cloudflare edge protection:

| Surface | Notes |
|---------|-------|
| SPA routes (`/`, `/about`, `/admin`, `/inbox/:address`) | Static, public |
| `POST /api/inboxes` | Anonymous — creates D1 rows + KV sessions |
| `POST /api/admin/login` | Anonymous — password check |
| `/api/*` (remaining) | Authenticated via Bearer token |
| `/ws` | WebSocket upgrade, ticket-authenticated |

The Worker already ships CSP, HSTS, `no-store` caching, and same-origin WebSocket checks. What it lacks is **request-side throttling** — Cloudflare fills that gap.

**Key limitation:** WAF covers HTTP traffic (including the initial `/ws` upgrade) but does **not** cover the Worker `email()` handler. Email-layer abuse requires separate application-side controls.

---

## Free Plan Budget

| Capability | Included |
|------------|----------|
| L7 DDoS mitigation | Yes |
| Free Managed Ruleset | Yes |
| Custom WAF rules | 5 |
| Rate limiting rules | 1 |
| Bot Fight Mode | Yes (broad, not configurable) |

The single rate-limiting rule is the tightest constraint; every recommendation below is designed around it.

---

## Risk Ranking

### High — anonymous write endpoints

1. **`POST /api/inboxes`** — drives D1 + KV resource creation; trivial to automate.
2. **`POST /api/admin/login`** — brute-force / credential-stuffing target.
3. **`/ws`** — WAF only sees the upgrade request; post-upgrade traffic is invisible to it.

### Moderate — scanner noise & probing

- `/api/*` in general (malformed requests, path traversal attempts).
- `/admin` (bot probing, automated navigation).
- Recon paths: `/.git`, `/.env`, `/wp-admin`, `/wp-login.php`, `/xmlrpc.php`, `/phpmyadmin`.

---

## Recommended Free Plan Configuration

### 1. Free Managed Ruleset — enable

Provides a strong baseline against known exploit patterns with no code changes. Start with Cloudflare's default action set, monitor Security Events, and avoid premature tuning.

### 2. Browser Integrity Check — keep enabled

The app is browser-only; this is a natural fit. Disable only if a specific compatibility issue surfaces.

### 3. Rate limit rule → `POST /api/inboxes`

Best use of the single free rule — this is the highest-volume anonymous write path.

| Parameter | Value |
|-----------|-------|
| Path | `/api/inboxes` |
| Method | `POST` |
| Counting | Per IP |
| Threshold | 3–5 requests / 10 s |
| Action | Block |
| Mitigation timeout | 10 s |

This blunts casual flooding but is too coarse to replace application-side limiting.

### 4. Custom WAF rules (5 available)

#### Rule A — Managed Challenge on `/admin`

```
http.request.uri.path eq "/admin"  →  Managed Challenge
```

Gates the admin entry page behind a browser challenge to deter automated probing.

#### Rule B — Challenge or allowlist `/api/admin/*`

```
starts_with(http.request.uri.path, "/api/admin/")  →  Managed Challenge
```

If admins operate from known IPs, prefer **IP allowlist + Block** instead — significantly stronger than challenges alone.

#### Rule C — Block recon paths

```
URI path in { /.git, /.env, /wp-admin, /wp-login.php, /xmlrpc.php, /phpmyadmin }  →  Block
```

Drops generic scanner traffic before it reaches the Worker, reducing log noise and wasted compute.

#### Rule D — Block invalid `/ws` requests

```
http.request.uri.path eq "/ws" and http.request.method ne "GET"  →  Block
```

Keep this conservative — WebSocket upgrades are sensitive to aggressive filtering. Optionally add browser-characteristic checks after testing confirms no false positives.

#### Rule E — Block foreign-origin API writes (optional)

```
Method in { POST, PATCH, DELETE } and starts_with(uri.path, "/api/")
  and Origin is present and Origin ≠ expected  →  Block
```

Deploy only after testing; some API clients or browser flows may omit `Origin`. Treat this as hygiene, not primary auth.

---

## Bot Fight Mode

Enable it — the app is browser-only, so the broad classification is acceptable. Test the WebSocket flow, admin login, and any synthetic monitors after enabling. If it later interferes with legitimate automation, a paid plan's configurable bot controls may be needed.

---

## What WAF Does Not Cover

### Inbound email abuse

The `email()` handler sits outside the HTTP path. WAF will not stop spam floods, oversized messages, attachment bombs, or SMTP-layer sender abuse.

Application-side controls needed:

- Message size and attachment count/size limits
- Sender / domain blocklists
- Per-inbox or per-domain ingestion quotas
- Early rejection of clearly abusive senders

### Application-layer brute force

Free-tier rate limiting alone is insufficient. The Worker should enforce its own limits on `POST /api/inboxes` and `POST /api/admin/login`, with escalating friction (e.g. short lockouts) on repeated failures.

### Token theft via XSS

Temp tokens live in `localStorage`; admin tokens in `sessionStorage`. The existing CSP and email HTML sanitizer are strong defenses, but browser-stored bearer tokens remain inherently sensitive. WAF reduces inbound attack volume; it does not eliminate the need for robust frontend XSS protection.

---

## Turnstile — Strongest Single Addition

**Turnstile** is the highest-value complement to WAF on the Free plan:

- **Where:** inbox creation form, admin login form.
- **Why:** WAF challenge pages are awkward for SPA `fetch()` flows. Turnstile is purpose-built for interactive forms and adds friction precisely at the two anonymous write points. Available on Free.

If only one thing is added beyond WAF configuration, it should be Turnstile on these two forms.

---

## Rollout Plan

### Phase 1 — Edge configuration (no code)

1. Enable Free Managed Ruleset.
2. Verify Browser Integrity Check is on.
3. Enable Bot Fight Mode; test for regressions.
4. Add rate limit rule for `POST /api/inboxes`.
5. Deploy custom rules A–E (admin challenge, recon block, `/ws` hardening, optional origin check).

### Phase 2 — Application improvements (low effort)

1. Integrate Turnstile on inbox creation and admin login forms.
2. Add Worker-side rate limiting for `POST /api/inboxes` and `POST /api/admin/login`.

### Phase 3 — Email-layer hardening

1. Enforce message size and attachment limits in the `email()` handler.
2. Add sender/domain abuse controls.
3. Add per-inbox ingestion quotas to protect D1/R2/KV during spam floods.

---

## Summary

| Layer | Control |
|-------|---------|
| **Managed Rules** | Free Managed Ruleset enabled |
| **Browser check** | Browser Integrity Check enabled |
| **Bot protection** | Bot Fight Mode enabled (if testing clean) |
| **Rate limiting** | Single rule on `POST /api/inboxes` |
| **Custom rules** | Challenge `/admin` and `/api/admin/*`; block recon paths and invalid `/ws` traffic; optionally block foreign-origin writes |
| **Turnstile** | Inbox creation + admin login forms |
| **App-side** | Worker rate limiting + email ingestion controls |

Cloudflare Free provides a meaningful baseline shield, but the real protection comes from combining a focused set of edge rules with Turnstile and application-side abuse controls.
