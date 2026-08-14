# Deploying SheetWatch

Serving on Vercel, recurring work on a VM.

```
Browser ──▶ Vercel · sheet-watch        (static PWA; proxies /api /auth /public)
   │            │
   │            └──▶ Vercel · sheet-watch-api   (Express, serverless — HTTP only)
   │                              │
   └──WebSocket──▶ Cloudflare      │
        sheetwatch-realtime        │
                                   ▼
Hetzner VM ──────────────────▶ Neon Postgres
  ├ poll worker      per-sheet BullMQ timers, exact pollInterval
  ├ notify worker    push · email · webhook · telegram
  ├ compare worker   cross-sheet sweep every 120s
  ├ reconcile        re-derives schedules from the DB every 60s
  ├ maintenance      digests · reports · prune · quiet-hours flush, every 5 min
  └ redis            private to the compose network
```

The Vercel API answers browser requests and nothing else — it never opens a
Redis connection and never runs a poll on a timer. Everything recurring happens
on the VM.

`/api/cron/*` still exists as a no-VM fallback; see
[Alternative: no VM](#alternative-no-vm). It is unused in this topology.

---

## Why the client proxies the API

`client/vercel.json` rewrites `/auth/*`, `/api/*` and `/public/*` to the API
deployment, and `VITE_API_BASE_URL` is left **empty** so the browser only ever
talks to its own origin.

This is load-bearing, not decoration. The session cookie (`sw_session`) is set
by the API. If the browser called `sheet-watch-api.vercel.app` directly from
`sheet-watch.vercel.app`, that cookie would be a **third-party cookie** — Safari
blocks those outright, so sign-in would fail on macOS Safari and on every
iPhone. iOS is exactly where the PWA install matters, since it's the only way
web push works there at all.

Routing everything through one origin makes the cookie first-party and the
problem disappears. Don't "simplify" this by pointing `VITE_API_BASE_URL` at the
API domain — it will work in your Chrome and break for iPhone users.

> A custom domain (`app.example.com` + `api.example.com`) would also solve it,
> since those share a registrable domain. Switch to that later and the proxy
> rewrites can go away.

---

## 1. Neon (Postgres)

Create a project, then grab **two** connection strings:

| Which | Looks like | Used by |
|---|---|---|
| Pooled | `…-pooler.<region>.aws.neon.tech/…` | the Vercel API |
| Direct | `…<region>.aws.neon.tech/…` | the VM worker, and `prisma migrate` |

Append `?sslmode=require&pgbouncer=true&connection_limit=1` to the **pooled**
one. Serverless invocations each want their own pool; without the cap you
exhaust Neon's connection limit under very little traffic.

The VM worker is a single long-running process that manages its own pool, so it
uses the **direct** URL — routing it through PgBouncer buys nothing and costs
you prepared statements.

Migrations need a real session (advisory locks, DDL), which PgBouncer in
transaction mode can't provide — hence `DIRECT_URL` everywhere. Prisma does not
fall back if it's missing, it hard-errors.

Migrations run automatically on every API deploy, via `server/vercel.json`:

```json
"buildCommand": "prisma generate && prisma migrate deploy",
"outputDirectory": "public",
```

### Why `server/public/index.html` exists

Defining any `buildCommand` makes Vercel look for a static output directory once
the build finishes — and this build produces none, it only generates the Prisma
client and migrates. Vercel rejects both a missing directory *and* an empty one:

```
Error: No Output Directory named "public" found after the Build completed.
Error: The Output Directory "public" is empty.
```

So `server/public/index.html` is committed to satisfy it. It's a placeholder,
but not a useless one: Vercel checks the filesystem before applying `rewrites`,
so it's what you get at the API domain's root, while every other path falls
through the catch-all rewrite to `api/index.ts`. Don't delete it, and don't add
files whose names collide with an API route.

---

## 2. Vercel — API project

New project from this repo, **Root Directory `server`**.

Name it **`sheet-watch-api`**. A different name means updating the four rewrite
destinations in `client/vercel.json` to match.

| Var | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** URL (with `connection_limit=1`) |
| `DIRECT_URL` | Neon **direct** URL |
| `SESSION_SECRET` | 32+ random chars |
| `TOKEN_ENCRYPTION_KEY` | 64 hex chars |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from Google Cloud |
| `GOOGLE_REDIRECT_URI` | `https://sheet-watch.vercel.app/auth/google/callback` — the **client** origin, via the proxy |
| `FRONTEND_URL` | `https://sheet-watch.vercel.app` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_MAILTO` | `npx web-push generate-vapid-keys` |
| `NODE_ENV` | `production` |
| `WORKER_MODE` | **unset** |
| `REDIS_URL` | **unset** |
| `CRON_SECRET` | **unset** — see [Alternative](#alternative-no-vm) |
| `RESEND_API_KEY` / `EMAIL_FROM` | optional, for the test-notification button |
| `REALTIME_URL` / `REALTIME_SECRET` | optional, from step 6 |

Leaving `WORKER_MODE` and `REDIS_URL` unset is what keeps the function free of
Redis: `shared/redis.ts` builds its client lazily and every `queues.ts` export
no-ops, so a cold start never opens a socket it has no use for.

`NODE_ENV=production` is what flips the session cookie to `Secure` and makes
`env.ts` reject a wildcard `FRONTEND_URL`. Don't skip it.

You'll see `CRON_SECRET is not set — /api/cron/* will reject every call` in the
logs. Expected here: the VM owns polling.

---

## 3. Vercel — client project

Second project, same repo, **Root Directory `client`**, name **`sheet-watch`**.

| Var | Value |
|---|---|
| `VITE_API_BASE_URL` | **empty string** — see [above](#why-the-client-proxies-the-api) |
| `VITE_VAPID_PUBLIC_KEY` | byte-identical to the API's `VAPID_PUBLIC_KEY` |

Vite inlines these at build time, so changing either needs a redeploy, not just
an env edit.

---

## 4. Google Cloud

**APIs & Services → Credentials → your OAuth client**, authorized redirect URI:

```
https://sheet-watch.vercel.app/auth/google/callback
```

The client origin, not the API's — Google redirects the *browser*, and the
browser must land on the origin that owns the cookie. The proxy forwards it from
there. `GOOGLE_REDIRECT_URI` on the API must match character-for-character;
Google rejects the token exchange otherwise.

Keep the consent screen in **Testing** for personal use. Tradeoff: refresh
tokens expire after ~7 days of inactivity and sheets start showing "Access
denied — re-authorize in the app." Publishing removes that at the cost of
Google's verification review.

---

## 5. Hetzner VM — worker + Redis

A CX22 (2 vCPU / 4 GB) is far more than this needs. Install Docker, clone the
repo, then:

```bash
cd server
cp .env.example .env.production
$EDITOR .env.production
docker compose up -d --build
docker compose logs -f worker
```

Expect:

```
Scheduled 8 sheet poll job(s)
Worker started — poll + notify + compare workers running
```

`.env.production` takes the **same values as the Vercel API**, with three
differences:

| Var | VM value | Why |
|---|---|---|
| `DATABASE_URL` | Neon **direct** URL | long-running process, own pool |
| `WORKER_MODE` | `bullmq` | selects the queue-backed path |
| `REDIS_URL` | ignored | compose overrides it to `redis://redis:6379` |

Everything else — `TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`/`SECRET`, the VAPID
pair, `FRONTEND_URL`, `RESEND_API_KEY`, `TELEGRAM_BOT_TOKEN`, `REALTIME_*` —
must match the API exactly. `TOKEN_ENCRYPTION_KEY` especially: the worker
decrypts the same stored Google refresh tokens the API wrote, so a mismatch
means every sheet fails to poll.

`SESSION_SECRET` and `GOOGLE_REDIRECT_URI` are unused by the worker but still
required by `env.ts`, which validates one shared list. Copy them across.

### Networking

Neither container publishes a port. Redis is reachable only on the compose
network under the hostname `redis`; the worker makes outbound connections only.
**The VM needs no inbound firewall rule beyond SSH.** Do not add one.

### How the VM learns about UI changes

The Vercel API can't schedule jobs — no Redis. So the worker re-derives
everything from the database itself, every 60 seconds
(`src/worker/scheduler.ts`):

- sheet added → scheduler created
- sheet paused / archived / deleted → scheduler pruned
- `pollInterval` edited → scheduler retimed

It only writes when something actually differs, so it never churns a scheduler
or pushes back its next run. A new sheet starts polling within a minute of being
added. Redis losing its data is survivable for the same reason — the next
reconcile rebuilds every schedule.

### Updating

```bash
git pull && docker compose up -d --build
```

Schema changes are applied by the Vercel API build, not here. If you'd rather
migrate from the VM: `docker compose run --rm worker npx prisma migrate deploy`.

---

## 6. Cloudflare realtime worker (optional)

```bash
cd realtime
npm install
npx wrangler deploy
npx wrangler secret put REALTIME_SECRET     # a long random string
```

Set `REALTIME_URL` (the deployed `https://…workers.dev` origin) and
`REALTIME_SECRET` on **both** the Vercel API and the VM worker — the API mints
the client's token, the worker publishes the events. Redeploy both.

The client discovers the URL from `GET /api/realtime/token`; no client env var.
The WebSocket goes browser → Cloudflare directly, authenticated by a 120s HMAC
token in the query string, so it's unaffected by the cookie/proxy arrangement.
Leave it all unset and the app falls back to 30s polling with no other change.

---

## Deploy order

1. Neon project, both URLs in hand
2. Vercel API project → deploy (this is what creates the schema)
3. Vercel client project → deploy
4. Google redirect URI
5. VM: `docker compose up -d --build`
6. Realtime worker, if wanted

Steps 2 and 3 reference each other's URLs — set both from the project names up
front rather than waiting for the first deploy.

---

## Verification

```bash
curl https://sheet-watch.vercel.app/healthz          # {"ok":true} — proxy works
curl https://sheet-watch-api.vercel.app/healthz      # {"ok":true} — API works
docker compose logs --tail=20 worker                # on the VM
```

Then in a browser:

1. Sign in with Google — you should land back on your start page
2. **Hard-reload and confirm you're still signed in.** The cookie test; if it
   fails, the proxy isn't forwarding `Set-Cookie`
3. Repeat in **Safari**, and on an iPhone after Share → Add to Home Screen
4. Add a sheet. Within ~60s the VM logs
   `Sheet jobs reconciled: N active (+1 new, …)` — that's the handoff working
5. Edit a cell, wait one `pollInterval`, confirm the change row appears
6. Enable push, edit again, confirm the notification
7. Settings → Notifications shows the delivery log with `sent` rows

Step 4 is the one worth watching. If the reconcile line never appears, the VM
isn't reaching Neon, or its `DATABASE_URL` points somewhere other than the API's.

---

## Execution modes

One switch, `WORKER_MODE`, decides who owns the recurring work:

| | `WORKER_MODE=bullmq` (the VM) | unset (Vercel API, and the no-VM fallback) |
|---|---|---|
| Trigger | repeatable BullMQ jobs | external scheduler → `/api/cron/*` |
| Polling | `poll` worker, concurrency 5, **exact `pollInterval`** | inline, rounded up to the cron tick |
| Notifications | `notify` worker | inline |
| Compare sweep | `compare` worker, every 120s | `/api/cron/maintenance` |
| Digests / reports / prune / flush | `setInterval`, every 5 min | `/api/cron/maintenance` |
| Schedule reconcile | every 60s from the DB | n/a |
| "Check now" | enqueued, returns instantly | polls inline (~2–5s) |
| Redis | required | not used |

Both paths call the same `shared/` code, so behaviour on a detected change is
identical. What differs is timing: on the VM a sheet set to 60s really is polled
every 60s.

`src/worker/index.ts` sets `WORKER_MODE=bullmq` on itself as its first
statement, so running the worker never depends on the environment being right.

---

## Alternative: no VM

If you'd rather drop the VM, the same endpoints run everything from an external
scheduler (Upstash QStash, cron-job.org, a crontab anywhere). Leave the Vercel
API's `WORKER_MODE` and `REDIS_URL` unset — they already are — and set
`CRON_SECRET`. Then schedule **both**:

| | Path | Suggested cron |
|---|---|---|
| Poll | `POST /api/cron/poll` | `*/5 * * * *` |
| Maintenance | `POST /api/cron/maintenance` | `*/15 * * * *` |

Both take `Authorization: Bearer <CRON_SECRET>`. Both accept GET and POST.

```bash
curl -X POST https://sheet-watch-api.vercel.app/api/cron/poll \
  -H "Authorization: Bearer $CRON_SECRET"
# {"due":3,"checked":3,"skipped":0,"changed":1,"failed":0}
```

**Schedule both or things silently stop.** `/poll` only polls sheets; digests,
reports, pruning, the quiet-hours flush and the compare sweep all live on
`/maintenance`. Miss it and change notifications keep working while everything
else quietly dies.

They're split because they have opposite shapes: polling is parallel and short,
while `recomputeAllGroups()` is sequential with live Google reads per compare
target and has no business sharing a 60-second budget with it.

Tradeoffs versus the VM: `pollInterval` rounds up to the cron tick, every run is
capped at 60s, and on QStash's free tier (500 messages/day) `*/5` + `*/15` is
384/day — a 1-minute poll would be 1536/day and needs pay-as-you-go.

`/api/cron/poll` claims each sheet with a compare-and-swap on `lastCheckedAt`
before polling, so overlapping runs can't both poll one sheet and raise
duplicate notifications. The loser is reported under `skipped`; non-zero there
means your schedule is tighter than a run actually takes.

---

## Known limits

**Rate limiting is per-instance.** `api/middleware/rateLimit.ts` keeps counters
in a `Map`, so each warm Lambda has its own bucket and the effective limit is
`max × instances`. It still blunts a single-source hammer on the OAuth routes;
it is not a distributed limiter.

**"Check now" polls inline on Vercel.** With `WORKER_MODE` unset the API can't
enqueue, so the button does the Google fetch inside the request (~2–5s) rather
than handing it to the VM. It works and stays well inside the function budget;
it's just slower than local dev, where it returns instantly.

**Google Sheets API quota.** Reads are capped per minute per project and per
user. The VM issues one read per sheet per `pollInterval`, plus one per compare
target every 120s. Worth doing the arithmetic before putting a hundred sheets on
a 60-second interval.

**Neon autosuspend.** On the free tier the database sleeps when idle. The VM
worker polls continuously, so in this topology it stays awake.

**Vercel build runs migrations.** Every API deploy runs `prisma migrate deploy`
against production. A broken migration fails the build rather than half-applying,
but review migrations before pushing to `main`.
