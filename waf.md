# Cloudflare WAF Guide for Your flamemail Deployment

If you are deploying your own flamemail instance, this guide helps you choose a practical WAF setup for the Free plan.

The goal is not to eliminate all abuse at the edge. The goal is to reduce cheap HTTP abuse before it reaches your Worker, while keeping the application usable for real visitors.

## What you are protecting

All unauthenticated routes live under `/api/public`. Everything under `/api/protected` requires a bearer token. This split makes WAF rules easy to target.

| Surface                                             | Method                   | Auth            | Notes                                   |
| --------------------------------------------------- | ------------------------ | --------------- | --------------------------------------- |
| `/`, `/about`, `/admin`, `/link`, `/inbox/:address` | GET                      | None            | SPA pages and route shells              |
| `/api/public/config`                                | GET                      | None            | Bootstrap config (Turnstile site key)   |
| `/api/public/domains`                               | GET                      | None            | Read-only domain list                   |
| `/api/public/inboxes`                               | POST                     | None            | Creates inbox state in D1 and KV        |
| `/api/public/admin/login`                           | POST                     | None            | Admin password entry point              |
| `/api/protected/inboxes/:address`                   | GET, DELETE              | Inbox token     | Inbox metadata and deletion             |
| `/api/protected/inboxes/:address/extend`            | POST                     | Inbox token     | Extend inbox TTL                        |
| `/api/protected/inboxes/:address/ws-ticket`         | POST                     | Inbox token     | Issue one-time WebSocket ticket         |
| `/api/protected/inboxes/:address/emails/*`          | GET, DELETE              | Inbox token     | Email listing, detail, raw, attachments |
| `/api/protected/admin/*`                            | GET, POST, PATCH, DELETE | Admin token     | Domain and inbox management             |
| `/ws`                                               | GET                      | One-time ticket | WebSocket upgrade                       |

flamemail already includes:

- strict security headers on HTTP responses
- same-origin checks on WebSocket upgrades
- token-based authorization for inbox and admin APIs
- Cloudflare Turnstile verification on inbox creation and admin login
- email HTML sanitization and isolated rendering

What flamemail does **not** include yet is Worker-side throttling and lockout behavior for the public write endpoints. Turnstile adds useful friction, but Cloudflare edge controls should still be treated as a first layer rather than your only layer.

**Important:** Cloudflare WAF applies to HTTP traffic, including the initial `/ws` upgrade request. It does **not** inspect or protect the Worker `email()` handler. Inbound email abuse needs separate controls inside the application.

---

## Free plan capabilities

| Capability              | Limit       | Notes                                                                               |
| ----------------------- | ----------- | ----------------------------------------------------------------------------------- |
| L7 DDoS mitigation      | Unmetered   | Included on all plans                                                               |
| Free Managed Ruleset    | Included    | Subset of the full Cloudflare Managed Ruleset, covers high-severity vulnerabilities |
| Custom WAF rules        | **5 rules** | All actions except Log; no regex (Business+)                                        |
| Rate limiting rules     | **1 rule**  | IP-based counting only; 10 s minimum period                                         |
| Bot Fight Mode          | Included    | Domain-wide, not configurable, cannot be bypassed with Skip rules                   |
| Browser Integrity Check | Included    | Enabled by default                                                                  |
| WAF body inspection     | Up to 1 MB  | Default on Free                                                                     |

**Not available on Free:** Cloudflare Managed Ruleset (full), OWASP Core Ruleset, Exposed Credentials Check, WAF Attack Score, Super Bot Fight Mode, Bot Management.

---

## Where abuse is most likely

### Highest priority

1. **`POST /api/public/inboxes`** — Anonymous callers can create inbox state, which drives D1 and KV usage. Turnstile helps, but this path is still worth edge rate limiting.

2. **`POST /api/public/admin/login`** — Admin password entry point and the most obvious brute-force target. Turnstile should stay enabled here, but login rate limits and short lockouts are still valuable.

3. **`/ws`** — Cloudflare only sees the handshake request. After the WebSocket is established, edge protections no longer inspect message traffic.

### Secondary priority

- **`/admin`** — Attackers and scanners will probe this page even if they do not know how your admin flow works.
- **Recon paths** — Generic scanners request `/.git`, `/.env`, `/wp-admin`, `/wp-login.php`, `/xmlrpc.php`, `/phpmyadmin`, etc.
- **General `/api/*` noise** — Malformed requests, probing, and random exploit traffic even for paths that are not valid in flamemail.

---

## Recommended Cloudflare Free configuration

### 1. Enable the Free Managed Ruleset

This gives you baseline protection against known web exploit patterns with no application changes.

- Enable the default managed ruleset.
- Review Security Events after deployment.
- Avoid aggressive tuning until you have real traffic data.

### 2. Keep Browser Integrity Check enabled

flamemail is browser-first, so Browser Integrity Check is a reasonable fit. Leave it on unless you find a specific compatibility problem.

### 3. Use your one rate-limit rule on `POST /api/public/*`

You only get one rate-limit rule on Free, so spend it on the anonymous write surface.

| Parameter          | Value                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Expression         | `http.host eq "<YOUR_HOSTNAME>" and http.request.method eq "POST" and starts_with(http.request.uri.path, "/api/public/")` |
| Counting           | Per IP                                                                                                                    |
| Threshold          | 3-5 requests / 10 s                                                                                                       |
| Action             | Block                                                                                                                     |
| Mitigation timeout | 10 s                                                                                                                      |

This is intentionally conservative. It slows down casual abuse but is **not** a replacement for application-side throttling. Cloudflare documents rate limiting as approximate, so some excess requests may still reach your Worker before mitigation starts.

Because all unauthenticated write endpoints live under `/api/public`, this single rule covers both inbox creation and admin login. If your plan ever upgrades to Pro (2 rate-limit rules), you can add a tighter rule specifically for `/api/public/admin/login`.

### 4. Use custom rules for low-risk edge filtering

You have 5 custom rules on Free. Here is a suggested allocation:

#### Rule 1 — Challenge `/admin`

```
http.host eq "<YOUR_HOSTNAME>" and http.request.uri.path eq "/admin"  →  Managed Challenge
```

Good fit because this is a normal browser navigation, not a JSON API call.

#### Rule 2 — Restrict `/api/protected/admin/*` by IP (if you can)

If you administer from stable IP addresses:

```
http.host eq "<YOUR_HOSTNAME>" and starts_with(http.request.uri.path, "/api/protected/admin/") and not ip.src in { <ADMIN_IPS> }  →  Block
```

If you do **not** have stable admin IPs, skip this rule. Do not challenge `/api/protected/admin/*` — flamemail's admin UI uses SPA API requests, and challenge flows break JSON endpoints. Instead, protect `/admin` (Rule 1), keep Turnstile enabled on the login form, and add Worker-side lockouts.

#### Rule 3 — Block common recon paths

```
http.host eq "<YOUR_HOSTNAME>" and http.request.uri.path in {"/.git" "/.env" "/wp-admin" "/wp-login.php" "/xmlrpc.php" "/phpmyadmin"}  →  Block
```

Removes common scanner noise before it reaches your Worker.

#### Rule 4 — Reject invalid `/ws` requests

```
http.host eq "<YOUR_HOSTNAME>" and http.request.uri.path eq "/ws" and http.request.method ne "GET"  →  Block
```

Low-risk cleanup rule. Keep it simple — WebSocket traffic is sensitive to aggressive edge filtering.

#### Rule 5 — Reject suspicious cross-origin API writes (optional)

```
http.host eq "<YOUR_HOSTNAME>" and (http.request.method in {"POST" "PATCH" "DELETE"}) and starts_with(http.request.uri.path, "/api/") and len(http.request.headers["origin"]) gt 0 and http.request.headers["origin"] ne "https://<YOUR_HOSTNAME>"  →  Block
```

Only use this after testing. Some clients omit `Origin`, so treat this as hygiene rather than primary protection.

---

## Bot Fight Mode

Bot Fight Mode is available on Free but should be treated as **optional**, not mandatory.

Why to be cautious:

- It applies across the whole domain with no per-path control.
- It may interfere with API traffic.
- On Free, it **cannot be bypassed** using WAF Skip rules (unlike Super Bot Fight Mode on paid plans).

If you enable it, test these flows explicitly:

- creating an inbox via `POST /api/public/inboxes`
- admin login via `POST /api/public/admin/login`
- authenticated admin API fetches under `/api/protected/admin/*`
- the `/ws` upgrade flow
- any uptime checks or synthetic monitoring you run

If Bot Fight Mode causes regressions, disable it rather than trying to work around it.

---

## What Cloudflare will not solve for you

### Inbound email abuse

flamemail's `email()` handler is not an HTTP endpoint, so WAF rules do not protect it.

flamemail already enforces a few inbound guardrails:

- messages larger than 10 MiB are rejected
- messages with more than 10 attachments are rejected
- delivery is rejected when an inbox already holds 100 emails

If you expect real spam pressure, consider adding:

- sender or domain blocklists
- per-sender or per-domain ingestion quotas
- per-attachment or cumulative attachment size caps
- earlier rejection of clearly abusive senders

### Application-layer brute force and resource abuse

Cloudflare rate limiting on Free gives you one rule. Turnstile reduces cheap automation. Neither replaces Worker-side throttling, quotas, or lockouts.

For a serious deployment, add Worker-side limits for:

- `POST /api/public/inboxes` — throttle inbox creation per IP
- `POST /api/public/admin/login` — throttle and add short lockouts after repeated failures

### Browser token theft through XSS

Temporary inbox tokens are stored in `localStorage`, and admin tokens are stored in `sessionStorage`.

flamemail has strong defenses around CSP and email HTML sanitization, but browser-stored bearer tokens remain sensitive by nature. WAF can reduce incoming attack traffic but does not remove the need for robust frontend XSS protection.

---

## Suggested rollout

### Phase 1 — Cloudflare edge configuration

1. Enable the Free Managed Ruleset.
2. Confirm Browser Integrity Check is enabled.
3. Decide whether to enable Bot Fight Mode. If you do, test it carefully.
4. Add your one rate-limit rule targeting `POST /api/public/*`.
5. Add custom rules: `/admin` challenge, recon path blocking, invalid `/ws` rejection.
6. Optionally add IP allowlist for `/api/protected/admin/*` and cross-origin write blocking.

### Phase 2 — Application hardening

1. Create a Turnstile widget and configure `TURNSTILE_SITE_KEY` plus `TURNSTILE_SECRET_KEY`.
2. Verify `GET /api/public/config`, inbox creation, and admin login work end-to-end.
3. Add Worker-side throttling for `POST /api/public/inboxes`.
4. Add Worker-side throttling and short lockouts for `POST /api/public/admin/login`.

### Phase 3 — Email abuse controls

1. Add sender and domain abuse controls.
2. Add per-sender or per-domain ingestion quotas.
3. Add stricter attachment-size controls if your deployment starts seeing spam pressure.

---

## Recommended baseline at a glance

| Layer                | Recommended baseline                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Managed Rules        | Enable the Free Managed Ruleset                                                                                                                       |
| Browser filtering    | Keep Browser Integrity Check enabled                                                                                                                  |
| Bot controls         | Treat Bot Fight Mode as optional; test before keeping it on                                                                                           |
| Rate limiting        | 1 rule on Free — use it on `POST /api/public/*` to cover all unauthenticated writes                                                                   |
| Custom rules (5)     | Challenge `/admin`, block recon paths, reject invalid `/ws`, optionally restrict `/api/protected/admin/*` by IP, optionally block cross-origin writes |
| Form protection      | Keep Turnstile enabled on inbox creation and admin login                                                                                              |
| Application controls | Add Worker-side throttling, login lockouts, and email abuse controls                                                                                  |
