# BullMQ worker image — the long-running half of the server that Vercel can't
# host. Runs the poll, notify and compare workers plus the reconcile and
# maintenance intervals. Makes outbound connections only (Neon, Google, Resend,
# Cloudflare) and talks to Redis over the compose network, so it exposes no
# ports.

FROM node:20-slim

# Prisma's query engine links against OpenSSL; ca-certificates is needed for TLS
# out to Neon and the Google APIs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dev dependencies stay in the image on purpose: `tsc` builds here, and the
# prisma CLI is what runs `prisma migrate deploy` from this same container if
# you ever want to migrate from the VM instead of from a Vercel build.
COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
# src/worker/index.ts also sets this on itself; belt and braces.
ENV WORKER_MODE=bullmq

CMD ["node", "dist/worker/index.js"]
