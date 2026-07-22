# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
COPY . .
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npm run db:generate && npm run build

FROM base AS production-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS app
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM base AS worker
ENV NODE_ENV=production
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/build/worker/sync-vocadb.mjs ./build/worker/sync-vocadb.mjs
COPY --from=builder --chown=node:node /app/prisma ./prisma
USER node
ENTRYPOINT ["node", "/app/build/worker/sync-vocadb.mjs"]

FROM deps AS migrate
ENV NODE_ENV=production
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY tsconfig.json ./tsconfig.json
ENTRYPOINT ["npm", "run", "db:deploy"]
