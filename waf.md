# Cloudflare WAF Guide for Your flamemail Deployment

If you are deploying your own flamemail instance behind Cloudflare, this guide helps you choose a practical WAF setup for the Free plan.

The goal is not to eliminate all abuse at the edge. The goal is to reduce cheap HTTP abuse before it reaches your Worker, while keeping the application usable for real visitors.

## What you are protecting

Your flamemail deployment exposes a small HTTP surface:

| Surface | Notes |
|---------|-------|
| SPA routes (`/`, `/about`, `/admin`, `/link`, `/inbox/:address`) | Public pages and route shells |
| `GET /api/domains` | Public, read-only |
| `GET /api/config` | Public, read-only bootstrap for the Turnstile site key |
| `POST /api/inboxes` | Public write endpoint that creates inbox state |
| `POST /api/admin/login` | Public write endpoint for admin authentication |
| Most other `/api/*` routes | Protected by bearer tokens |
| `/ws` | WebSocket upgrade endpoint using a one-time ticket |

flamemail already includes several useful protections in the Worker:

- strict security headers for HTTP responses
- same-origin checks on WebSocket upgrades
- token-based authorization for inbox and admin APIs
- Cloudflare Turnstile verification on inbox creation and admin login
- email HTML sanitization and isolated rendering

What flamemail still does **not** include is strong application-side throttling and lockout behavior for the anonymous HTTP write endpoints. Turnstile adds useful friction, but Cloudflare edge controls should still be treated as a first layer rather than your only layer.

**Important:** Cloudflare WAF applies to HTTP traffic, including the initial `/ws` upgrade request. It does **not** inspect or protect the Worker `email()` handler. Inbound email abuse needs separate controls inside the application.

---

## Free plan expectations

If you are deploying on Cloudflare Free, you can generally rely on:

| Capability | Availability |
|------------|--------------|
| L7 DDoS mitigation | Included |
| Free Managed Ruleset | Included |
| Custom WAF rules | 5 rules |
| Rate limiting rules | Limited on Free — verify your current quota in the dashboard |
| Bot Fight Mode | Included, but broad and not configurable |

For most self-hosted flamemail deployments, rate-limiting capacity is the main constraint. If your zone only has room for a single rate-limit rule, spend it on `POST /api/inboxes`. If your plan or dashboard exposes more than one rule, the next best target is `POST /api/admin/login`.

---

## Where abuse is most likely

### Highest priority

1. **`POST /api/inboxes`**

   Anonymous callers can create inbox state, which drives D1 and KV usage. Turnstile helps, but this path is still worth edge rate limiting.

2. **`POST /api/admin/login`**

   This is your admin password entry point, so it is the most obvious brute-force target. Turnstile should stay enabled here, but login rate limits and short lockouts are still valuable.

3. **`/ws`**

   Cloudflare only sees the handshake request. After the WebSocket is established, edge protections no longer inspect message traffic.

### Secondary priority

- **`/admin`**

  Attackers and scanners will probe this page even if they do not know how your admin flow works.

- **Recon paths**

  Generic scanners often request paths like `/.git`, `/.env`, `/wp-admin`, `/wp-login.php`, `/xmlrpc.php`, and `/phpmyadmin`.

- **General `/api/*` noise**

  Expect malformed requests, probing, and random exploit traffic even if those paths are not valid in flamemail.

---

## Recommended Cloudflare Free configuration

If you want a simple baseline that is unlikely to break normal use, start here.

### 1. Enable the Free Managed Ruleset

This gives you a broad baseline against known web exploit patterns with no application changes required.

Recommended approach:

- enable the default managed ruleset
- review Security Events after deployment
- avoid aggressive tuning until you have real traffic data

### 2. Keep Browser Integrity Check enabled

flamemail is browser-first, so Browser Integrity Check is usually a reasonable fit. Leave it on unless you find a specific compatibility problem.

### 3. Use your primary rate-limit rule on `POST /api/inboxes`

If you only have room for one rule, this is usually the best place to use it.

Suggested starting rule:

| Parameter | Value |
|-----------|-------|
| Expression | `http.host eq "<YOUR_HOSTNAME>" and http.request.method eq "POST" and http.request.uri.path eq "/api/inboxes"` |
| Counting | Per IP |
| Threshold | 3–5 requests / 10 s |
| Action | Block |
| Mitigation timeout | 10 s |

This is intentionally conservative. It will slow down casual abuse, but it is **not** a replacement for application-side throttling. Cloudflare also documents rate limiting as approximate, so some excess requests may still reach your Worker before mitigation starts.

If your plan allows a second rule, the next best candidate is:

```text
http.host eq "<YOUR_HOSTNAME>" and http.request.method eq "POST" and http.request.uri.path eq "/api/admin/login"
```

### 4. Use custom rules for low-risk edge filtering

Free plans are limited to five custom rules, so use them where they provide clear value.

#### Rule A — Protect `/admin` with Managed Challenge

```text
http.host eq "<YOUR_HOSTNAME>" and http.request.uri.path eq "/admin"  →  Managed Challenge
```

This is a good fit for the admin page itself because it is a normal browser navigation, not a JSON API call.

#### Rule B — Restrict `/api/admin/*` by IP if you can

If you administer your deployment from stable IP addresses, this is the strongest option:

```text
http.host eq "<YOUR_HOSTNAME>" and starts_with(http.request.uri.path, "/api/admin/") and not ip.src in { <ADMIN_IPS> }  →  Block
```

If you do **not** have stable admin IPs, do not default to challenging `/api/admin/*`. flamemail’s admin UI uses SPA API requests, and challenge flows are a poor fit for JSON endpoints. In that case, protect `/admin`, keep Turnstile enabled on the login form, and add Worker-side lockouts for repeated failures.

#### Rule C — Block common recon paths

```text
http.host eq "<YOUR_HOSTNAME>" and http.request.uri.path in {"/.git" "/.env" "/wp-admin" "/wp-login.php" "/xmlrpc.php" "/phpmyadmin"}  →  Block
```

This removes common scanner noise before it reaches your Worker.

#### Rule D — Reject obviously invalid `/ws` requests

```text
http.host eq "<YOUR_HOSTNAME>" and http.request.uri.path eq "/ws" and http.request.method ne "GET"  →  Block
```

This is a low-risk cleanup rule. Keep it simple. WebSocket traffic is sensitive to overly aggressive edge filtering.

#### Rule E — Optionally reject suspicious cross-origin API writes

```text
http.host eq "<YOUR_HOSTNAME>" and (http.request.method in {"POST" "PATCH" "DELETE"}) and starts_with(http.request.uri.path, "/api/") and len(http.request.headers["origin"]) gt 0 and http.request.headers["origin"] ne "https://<YOUR_HOSTNAME>"  →  Block
```

Only use this after testing. Some clients omit `Origin`, and this rule is best treated as hygiene rather than primary protection.

---

## Bot Fight Mode

Bot Fight Mode is available on Free, but you should treat it as **optional**, not mandatory.

Why to be cautious:

- it applies across the whole domain
- it may affect API traffic
- it cannot be skipped with custom rules on Free

If you enable it, test these flows explicitly:

- creating an inbox with `POST /api/inboxes`
- admin login with `POST /api/admin/login`
- authenticated admin API fetches
- the `/ws` upgrade flow
- any uptime checks or synthetic monitoring you run

If Bot Fight Mode causes regressions, disable it rather than trying to build path-based exceptions around it.

---

## What Cloudflare will not solve for you

### Inbound email abuse

flamemail’s `email()` handler is not an HTTP endpoint, so WAF rules do not protect it.

flamemail already enforces a few inbound guardrails:

- messages larger than 10 MiB are rejected
- messages with more than 10 attachments are rejected
- delivery is rejected when an inbox already holds 100 emails

If you expect real spam pressure, you should still consider adding:

- sender or domain blocklists
- per-sender or per-domain ingestion quotas
- per-attachment or cumulative attachment size caps
- earlier rejection of clearly abusive senders

### Application-layer brute force and resource abuse

Cloudflare rate limiting on Free is helpful, but it is not enough on its own. Turnstile reduces cheap automation, but it does not replace throttling, quotas, or lockouts.

For a serious deployment, you should still add Worker-side limits for:

- `POST /api/inboxes`
- `POST /api/admin/login`

For admin login in particular, short lockouts after repeated failures are worth adding.

### Browser token theft through XSS

Temporary inbox tokens are stored in `localStorage`, and admin tokens are stored in `sessionStorage`.

flamemail already has strong defenses around CSP and email HTML sanitization, but browser-stored bearer tokens remain sensitive by nature. WAF can reduce incoming attack traffic, but it does not remove the need for robust frontend XSS protection.

---

## Best application-side control beyond WAF

flamemail already ships with **Turnstile** on:

- the inbox creation form
- the admin login form

Keep it configured in every environment. The SPA fetches the public site key from `GET /api/config`, and the Worker verifies the response token before it creates inbox state or evaluates the admin password.

This remains a better fit than Cloudflare challenge pages for flamemail because both flows are interactive form submissions that lead into SPA API calls.

---

## Suggested rollout

If you are setting up a new deployment, this is a reasonable order of operations.

### Phase 1 — Cloudflare edge configuration

1. Enable the Free Managed Ruleset.
2. Confirm Browser Integrity Check is enabled.
3. Decide whether to enable Bot Fight Mode. If you do, test it carefully.
4. Add a rate-limit rule with expression `http.host eq "<YOUR_HOSTNAME>" and http.request.method eq "POST" and http.request.uri.path eq "/api/inboxes"`.
5. If your plan allows another rate-limit rule, add `http.host eq "<YOUR_HOSTNAME>" and http.request.method eq "POST" and http.request.uri.path eq "/api/admin/login"`.
6. Add custom rules for:
   - `/admin` challenge
   - recon path blocking
   - invalid `/ws` requests
   - optional cross-origin API write blocking
7. Add an IP allowlist rule for `/api/admin/*` only if your admin IPs are stable.

### Phase 2 — Application hardening

1. Create a Turnstile widget for your hostname and configure `TURNSTILE_SITE_KEY` plus `TURNSTILE_SECRET_KEY`.
2. Verify `GET /api/config`, inbox creation, and admin login work end-to-end.
3. Add Worker-side throttling for `POST /api/inboxes`.
4. Add Worker-side throttling and short lockouts for `POST /api/admin/login`.

### Phase 3 — Email abuse controls

1. Add sender and domain abuse controls.
2. Add per-sender or per-domain ingestion quotas.
3. Add stricter attachment-size controls if your deployment starts seeing spam pressure.

---

## Recommended baseline at a glance

| Layer | Recommended baseline |
|-------|----------------------|
| Managed Rules | Enable the Free Managed Ruleset |
| Browser filtering | Keep Browser Integrity Check enabled |
| Bot controls | Treat Bot Fight Mode as optional and test before keeping it on |
| Rate limiting | Prioritize `POST /api/inboxes`, then `POST /api/admin/login` if quota allows |
| Custom rules | Challenge `/admin`, block recon paths, reject invalid `/ws`, optionally restrict `/api/admin/*` by IP |
| Form protection | Keep Turnstile enabled on inbox creation and admin login |
| Application controls | Add Worker-side throttling, login lockouts, and email abuse controls |

For most operators, Cloudflare Free provides a useful first layer. The strongest deployment comes from combining a focused edge configuration with flamemail's built-in Turnstile checks and additional application-side abuse controls.
