# Mayor Agent — Full Handoff

Operational handoff covering **all three repos**. This same file lives in each repo so any one of them is self-contained for a new owner. In `mayor-email-backend` it pairs with `PROJECT_STATUS.md` (detailed done/to-do list).

---

## The system

Order-lifecycle automation for Mayor Clothing. **HubSpot** is the system of record; a **Google Sheet** ("MO sheet", ID `152hyxQz87IwPYl2lgBCm6pKKSjYl1hoL-AuZu-wODbo`) + **Google Drive** hold order state and generated docs; **Resend/Gmail** send mail; **Claude** drafts replies; **Nickel** handles payments.

| Repo | Role | Hosted |
|------|------|--------|
| `mayor-email-backend` | The agent. Express service, the automation brain. | **Live on Render** |
| `mayor-invoice` | Invoice-PDF generator + customer-facing order portal (JWT auth). | Render (free plan) |
| `mayor-tools` | Single-file browser invoice builder. No backend. | Static / open the file |

All three are on the **mayorclothing** GitHub org. The MO sheet is the shared spine — the backend writes order status to it; the invoice portal reads orders from it.

---

## Repo access & deploy (applies to all repos)

- Push access is **org-gated**. Auth as the org account: `gh auth login` (device flow), then `gh auth setup-git`. `gh` is installed at `C:\Program Files\GitHub CLI\gh.exe`. Pushing as `marcusgafford` alone → **403**.
- Both server repos deploy from a `render.yaml` blueprint; push to `main` and Render auto-deploys.

---

## 1. mayor-email-backend  (the agent — live)

Express (CommonJS). Two sub-agents:

- **Hermes** — a HubSpot deal-property change (or the hourly poll) generates an Order Confirmation / Invoice PDF, persists it to Drive + the MO sheet, and advances order status (Pending → In Transit → Delivered).
- **Leucrocotta** — every 15 min reads unread Gmail, classifies each message, and either flips an order to **Pending** when Nickel reports payment, or drafts a reply in Mayor's voice for Matt to review (accruing per-contact memory in Drive).

**State**: deployed & live at `https://mayor-email-backend.onrender.com` — web + `hermes-poll` (hourly) + `leucrocotta-poll` (every 15 min) crons. `/health` → 200. Both polls currently return `200 skipped` because external services aren't configured — **by design** (green = healthy, red = real failure). All code tested: `npm test` (4 suites), 26 files syntax-clean, endpoints exercised end-to-end, PDF rendering verified.

**Run locally**
```
npm install
cp .env.example .env
npm run dev      # node --watch index.js
npm test         # node --test
```
Boots with no env; polls just report `skipped`. Smoke test:
```
INTERNAL_API_KEY=testkey PORT=4123 node index.js &
curl -s localhost:4123/health
curl -s -X POST localhost:4123/hermes/poll      -H "Authorization: Bearer testkey"
curl -s -X POST localhost:4123/leucrocotta/poll -H "Authorization: Bearer testkey"
```

**`INTERNAL_API_KEY`** is a made-up shared secret; set it **identically** on all three Render services (web + both crons). `sync:false` means Render does NOT auto-fill the crons — enter each by hand. Blank on the web service ⇒ auth rejects everything (401).

**Key files**: `index.js` (wiring), `hermesService.js` (generation / status / webhook classification / poll), `hermesMapping.js` (deal→payload), `doc-render.js` (pdfkit), `googleStore.js` (Drive + MO-sheet), `leucrocotta/*` (inbox agent), `render.yaml`, `.env.example`.

---

## 2. mayor-invoice  (PDF generator + customer portal)

Express **5**. Renders invoice PDFs and serves a customer-facing order portal.

- **Routes**: `POST /generate` (invoice PDF), `GET /orders` → `portal.html`, `/portal/*` (JWT auth: `login`, `logout`, `forgot-password`, `set-password`, `create-account`, `orders`), `GET /health`.
- **Auth**: JWT (`jsonwebtoken`) + `bcryptjs`; user rows live in the MO sheet's `Users` tab.
- **Reads/writes** the same MO sheet (`SHEET_ID` hardcoded in `index.js` and `portal.js`).
- **PDF**: uses `pdfkit`, plus `puppeteer-core` + `@sparticuz/chromium` for headless-Chrome rendering (heavier than the backend's pdfkit-only path).
- **Deploy**: `render.yaml`, service `mayor-invoice`, plan **free**. Intended domain `orders.mayorclothing.com` (`BASE_URL` default).

**Env vars**
| Var | Notes |
|-----|-------|
| `GOOGLE_SERVICE_ACCOUNT` | ⚠️ named `GOOGLE_SERVICE_ACCOUNT` here — the backend calls the same thing `GOOGLE_SERVICE_ACCOUNT_JSON`. Don't copy-paste the key under the wrong name. |
| `JWT_SECRET` | **Must set in prod.** Defaults to a placeholder; code warns if unset when `NODE_ENV=production`. |
| `RESEND_API_KEY` | portal password-reset / notification mail |
| `BASE_URL` | defaults to `https://orders.mayorclothing.com` |
| `PORT` | Render sets it |
| `UPS_CLIENT_ID` / `UPS_CLIENT_SECRET` | OAuth client-credentials app from developer.ups.com (register a Tracking API app). Powers live "UPS Status" on the order detail page. |
| `UPS_ENV` | `test` → CIE sandbox host; anything else (or unset) → production. |

**Run locally**: `npm install && node index.js` (→ `:3000`). **No test suite** (`npm test` is a placeholder that errors).

---

## 3. mayor-tools  (browser invoice builder)

A single `index.html` ("Mayor Tools") — a **client-side** invoice generator, no server and no build step. Open it in a browser or drop it on any static host. Nothing to deploy or configure.

---

## What's left — configuration only (backend), in priority order

Everything below is dashboard/console work, not code. Full detail in the backend's `PROJECT_STATUS.md`.

1. **Google service account** — set `GOOGLE_SERVICE_ACCOUNT_JSON` (backend) / `GOOGLE_SERVICE_ACCOUNT` (invoice), grant Gmail **domain-wide delegation** (`gmail.modify`) for `mayor@mayorclothing.com`, set `DRIVE_BRAIN_FOLDER_ID`. Unlocks all persistence + the entire Leucrocotta inbox agent. (`MO_SHEET_ID` already defaulted.)
2. **HubSpot** — create the 4 Deal trigger properties (`zc_trigger_oc`, `zd_trigger_invoice`, `zg_tracking_number`, `zf_delivered_date`), create a private app, set `HUBSPOT_TOKEN` / `HUBSPOT_CLIENT_SECRET` / `HUBSPOT_ORDER_DEAL_STAGE`, register a `deal.propertyChange` webhook → `/webhooks/hubspot`. Until the properties exist, triggers + poll silently no-op.
3. **Claude** — set `ANTHROPIC_API_KEY` so Leucrocotta drafts replies (without it, it classifies but won't draft).
4. **Resend** — `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_REPLY_TO`, `BRAND_LOGO_URL`.
5. **Invoice portal** — set `JWT_SECRET` and `GOOGLE_SERVICE_ACCOUNT` on the `mayor-invoice` service.

As each is added the corresponding poll stops saying `skipped` and starts acting.

---

## Gotchas (save yourself the debugging)

- **Nickel emails** come from `support@nickel.com` (NOT `notify@`) and are **HTML-only**; `gmailClient` strips tags and collapses whitespace to one line — never anchor regexes on newlines. Order ref lives in the phrase `Payment of $X for <ref> from <payer>` (subject + body) and a labeled `Order Reference` field. Some subjects have an **empty** ref (`for  from …`) — those can't be tied to an order and correctly no-op. `NICKEL_SENDER` defaults to `support@nickel.com`.
- **Two names for the Google key**: `GOOGLE_SERVICE_ACCOUNT_JSON` (backend) vs `GOOGLE_SERVICE_ACCOUNT` (invoice). Same JSON, different var name.
- **Cron `fromService` host wiring failed** (curl exit 7 — couldn't connect). The backend cron `startCommand`s now hardcode the public URL. If you re-introduce `fromService`, verify `$POLL_HOST` resolves to a bare hostname with no scheme.
- **curl exit codes** in cron logs: `7` = can't connect (bad/empty host), `22` = HTTP 4xx/5xx (`-f`) — usually `401` (key mismatch) or `500` (missing config on `/hermes/generate`).
- **Hermes idempotency** is in-memory and resets on restart; the persistent backstop is the MO-sheet row (the poll gates on it). Fine unless restarts cause churn.
- **Duplicated code**: `doc-render.js` exists in both `mayor-email-backend` and `mayor-invoice`; the MO-sheet detail-row layout is duplicated inside `googleStore.js`. Left as-is (marked `ponytail:`) — consolidate only if they diverge.
- **Stale local node servers**: several background `node.exe` processes can linger and answer on ports, giving misleading test results. Kill them before local smoke tests.
- **Portal session expires fast**: the `mayor_token` JWT cookie logs you out on a plain page refresh (F5 / hard reload) far sooner than you'd expect from casual use. Don't refresh the tab to "check something live" — open a fresh tab instead (shares the session cookie) or just re-sign-in. Root cause (exact `JWT_SECRET` expiry setting) not yet tracked down.

---

## Session — 2026-07-23: full-system audit + portal UI fixes

**Audit** (all three repos, live Render, live sheet, HubSpot, browser): every finding from `MAYOR-SECURITY-AUDIT.md` (2026-07-10) is fixed and verified still in place on `main` — checked source directly, not just the remediation doc's claims (JWT_SECRET throws at boot, `/generate` sanitizes payload, portal escapes all sheet-sourced HTML, HubSpot HMAC fixed + `trust proxy` set, formula-injection guard on every sheet write, auth rate limiting). Both Render web services live and healthy. Still open (need a human, not code): Turnstile/bot-check on `/generate` (declined for now), Google Workspace domain-wide-delegation scope tightening.

**Fixed this session** (`mayor-invoice`, all pushed to `main` + deployed):
1. `portal.html` — redesigned the UPS tracking timeline (bigger ringed dots, solid connector, highlighted latest event, dropped a redundant status badge) — this was the "ugly, needs a design pass" item from 2026-07-21.
2. `portal.js` `getOrderDetailData` print_background fix (from a prior session) — confirmed live and working end-to-end in the browser, not just in code.
3. Line-item images: some historical `Order Confirmations` rows have the Shopify **product-page URL** pasted into the `Product 1..5` sheet columns instead of an actual image file (verified directly against the live sheet — e.g. order 29811). `hermesMapping.js`/`portal.js` only check "is it https", not "is it an image", so this rendered a broken-image icon. `portal.html` now only renders `<img>` when the URL looks like an image file (extension check); otherwise falls back to a plain "View" link. The underlying bad sheet cells are a data problem, not a code one — fix at the source if it recurs.
4. Background bug: `showPage()` reset `backgroundImage`/`backgroundSize`/`backgroundColor` when leaving the order-detail page, but not the `backgroundRepeat:no-repeat` / `backgroundPosition:center` also set by the custom-print-background code — those leaked as inline styles and broke the default tiled background (showed one tiny centered instance instead of a full tile). Now resets all five properties.
5. Hairline seam across the tiled background patterns (auth-bg-1/2/3.png), repeating every ~297px down the page. Cause: `background-size: 950px auto` scales each image proportionally, and none of the three PNGs have a whole-pixel height at that width (e.g. auth-bg-1.png is 1725×540 → auto computes 297.4px), so each tiled repeat rounds independently and drifts out of alignment. Fixed by pinning both dimensions to whole pixels per image (950×297, 950×296, 950×295).

**Debugging note for next session**: the browser's disk cache reliably serves stale JS/CSS after a deploy even on a "fresh" new tab at the same URL — verify a fix actually landed by checking `document.documentElement.outerHTML` for the expected new code, not just by looking at the page. A cache-busting query string (`?_cb=<anything>`) forces a real fetch without triggering the fast session-expiry issue above the way F5 does.
