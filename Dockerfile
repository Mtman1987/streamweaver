FROM node:20-slim AS base

WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3 && \
    rm -rf /var/lib/apt/lists/*

COPY .npmrc package-lock.json package.json ./
COPY scripts/bootstrap-runtime.js ./scripts/bootstrap-runtime.js
RUN npm ci --include=dev

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p config logs MasterStats data tokens actions commands sb plugin-exports tmp scripts
RUN npm run build:simple

FROM node:20-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/config ./config
COPY --from=builder /app/data ./data
COPY --from=builder /app/logs ./logs
COPY --from=builder /app/tokens ./tokens
COPY --from=builder /app/actions ./actions
COPY --from=builder /app/commands ./commands
COPY --from=builder /app/sb ./sb
COPY --from=builder /app/plugin-exports ./plugin-exports
COPY --from=builder /app/MasterStats ./MasterStats
COPY --from=builder /app/tmp ./tmp
COPY --from=builder /app/scripts/bootstrap-runtime.js ./scripts/bootstrap-runtime.js
COPY --from=builder /app/docker-entrypoint.js ./docker-entrypoint.js

EXPOSE 3000
ENTRYPOINT ["node", "docker-entrypoint.js"]
CMD ["npx", "tsx", "server.ts"]
