# SheetWatch

Self-hosted portal that watches your Google Sheets 24/7. Paste a sheet link → it polls the sheet every few minutes, detects any cell change, and notifies you by **web push**, email, Slack/Discord/generic webhooks or **Telegram**.

- `server/` — Express API + BullMQ worker (Node + TypeScript + Prisma + Postgres + Redis)
- `client/` — React PWA (Vite + Tailwind v4 + shadcn/ui + Motion), installable for web push

## Feature highlights

- **Tracking** — per-sheet poll interval, tab/range scope or row-match mode, pause/snooze/archive with history kept
- **Alert rules v2** — OR groups of ANDed conditions (`eq/neq/gt/lt/contains/changes_to`), each group routable to specific channels (push / email / individual webhooks)
- **Quiet hours** — pushes + emails are held during your window and delivered when it ends (webhooks stay instant); full delivery log with retry under Settings → Notifications
- **KPI pins** — pin any cell, 24h delta + sparkline, drag to reorder, threshold alerts (above/below, fires once per crossing)
- **Charts** — turn any range into a live line/bar/area/donut chart on the Overview
- **Heatmap** — GitHub-style change-frequency calendar
- **Time travel** — snapshot timeline, diff vs current or between any two snapshots, CSV export
- **Scheduled reports** — daily/weekly email summaries with PDF/CSV attachments, per-project scope
- **Share links** — public, revocable, read-only KPI boards at `/share/<token>`
- **Deep customization** — Settings → Appearance: light/dark/system theme, accent color (any hex — the whole UI recolors), density, font size, animation intensity, 12/24h + relative/absolute times, start page, dashboard section order/visibility (server-synced, roams across devices)

---

## Prerequisites (local)

- Node 20+ (`node -v`)
- PostgreSQL running, with a `sheetwatch` database (already provisioned on this machine)
- Redis running (`redis-cli ping` → `PONG`)
- A Google Cloud OAuth client (see **Google Cloud setup** below) — **required for sign-in**

---

## Google Cloud setup (you must do this once)

Sign-in won't work until `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `server/.env` are filled.

1. Go to <https://console.cloud.google.com> → create a project (e.g. *SheetWatch*).
2. **APIs & Services → Library** → enable **Google Sheets API** and **Google Drive API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**, keep it in **Testing** mode.
   - Add your own Google account under **Test users**.
   - Scopes: `https://www.googleapis.com/auth/spreadsheets.readonly` and `https://www.googleapis.com/auth/drive.readonly`.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized redirect URI:** `http://localhost:4000/auth/google/callback`
5. Copy the **Client ID** and **Client Secret** into `server/.env`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

> Testing mode needs no Google verification for personal use. Tradeoff: refresh tokens can expire after ~7 days of inactivity — just sign in again if a sheet shows an "re-authorize" error.

---

## Run (local dev)

Three processes. Open three terminals.

**1. API** (port 4000)
```bash
cd server
npm run dev:api
```

**2. Worker** (polls + notifies)
```bash
cd server
npm run dev:worker
```

**3. Client** (port 5173)
```bash
cd client
npm run dev
```

Open <http://localhost:5173>, click **Sign in with Google**, then paste a Google Sheets URL you own. Click **Enable push** in the dashboard header to receive notifications. Edit a cell in the sheet — within the poll interval (180s default) you get a push and a row in the change history.

Health check: `curl http://localhost:4000/healthz` → `{"ok":true}`

---

## Environment variables

### `server/.env`
Already populated for local dev (DB, Redis, generated `SESSION_SECRET` / `TOKEN_ENCRYPTION_KEY` / VAPID keys). You only need to fill:
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — from Google Cloud setup above.
- `RESEND_API_KEY` — **optional**; leave empty for push-only. Email notifications and scheduled reports stay disabled until set (or configure SMTP).
- `TELEGRAM_BOT_TOKEN` — **optional**; create a bot with [@BotFather](https://t.me/botfather) to enable the Telegram channel (add your chat id under Settings → Integrations).
- `REALTIME_URL` / `REALTIME_SECRET` — **optional**; point at the realtime worker (see below) for instant live updates. Leave empty to stay on 30s polling.

### `client/.env`
```
VITE_API_BASE_URL=http://localhost:4000
VITE_VAPID_PUBLIC_KEY=<matches server VAPID_PUBLIC_KEY>
VITE_REALTIME_URL=ws://localhost:8787   # optional; the server also advertises this
```

---

## Notifications

- **Web push** — works on desktop Chrome/Firefox and Android without install. On **iPhone**, push only works once the app is installed as a PWA (Safari → Share → **Add to Home Screen**, iOS 16.4+) and opened from the home-screen icon.
- **Email** — disabled by default (push-only). To enable: sign up at [Resend](https://resend.com), verify a sender domain, set `RESEND_API_KEY` + `EMAIL_FROM` in `server/.env`, restart the worker.

Each tracked sheet has independent **Email** / **Push** toggles in the dashboard.

---

## Realtime updates (optional)

Without this the app polls every 30s. With the Cloudflare Worker in `realtime/`, changes appear instantly (live bell, toast, list/KPI refresh) and the header badge reads **live**.

```bash
cd realtime
npm install
echo 'REALTIME_SECRET=devsecret' > .dev.vars
npx wrangler dev            # ws://localhost:8787
```

Then set `REALTIME_URL=http://localhost:8787` and `REALTIME_SECRET=devsecret` in `server/.env` and restart the API. The client picks the URL up from the server automatically.

**Deploy:** `npx wrangler deploy`, then `npx wrangler secret put REALTIME_SECRET` (match it in `server/.env`). Set `REALTIME_URL` to the deployed `https://…workers.dev` origin.

How it works: a Durable Object holds every socket (topic `user:<id>`); the API mints a 120s HMAC token at `GET /api/realtime/token` so the browser socket can authenticate, and publishes change/KPI events to the worker's `POST /notify`. Fully optional and isolated — nothing else depends on it.

---

## Useful commands

```bash
# server
npm run build          # tsc → dist/  (production build)
npm run start:api      # node dist/api/index.js
npm run start:worker   # node dist/worker/index.js
npm run migrate        # prisma migrate deploy
npm run generate       # prisma generate

# inspect state
psql -d sheetwatch -c 'select email from "User";'
psql -d sheetwatch -c 'select label, "lastCheckedAt", "errorMessage" from "Sheet";'
redis-cli KEYS 'bull:poll:*'
```

---

## Deploy (later)

Split deploy per `plan.md` §11: client → Vercel; API + worker + Redis + Postgres → Render. In production set the session cookie to `SameSite=None; Secure` (the code already does this when `NODE_ENV=production`), point `GOOGLE_REDIRECT_URI` at the Render API URL, and set `FRONTEND_URL` to the Vercel origin for CORS + post-login redirect.
