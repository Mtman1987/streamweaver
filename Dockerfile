FROM node:20-slim AS base

WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3 && \
    rm -rf /var/lib/apt/lists/*

COPY .npmrc package-lock.json package.json ./
COPY patches ./patches
COPY scripts/bootstrap-runtime.js ./scripts/bootstrap-runtime.js
RUN npm ci --include=dev

FROM base AS builder
ARG NEXT_PUBLIC_TWITCH_CLIENT_ID
ARG NEXT_PUBLIC_STREAMWEAVE_WS_URL
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_STREAMWEAVE_URL
ENV NEXT_PUBLIC_TWITCH_CLIENT_ID=$NEXT_PUBLIC_TWITCH_CLIENT_ID
ENV NEXT_PUBLIC_STREAMWEAVE_WS_URL=$NEXT_PUBLIC_STREAMWEAVE_WS_URL
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL
ENV NEXT_PUBLIC_STREAMWEAVE_URL=$NEXT_PUBLIC_STREAMWEAVE_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p config logs MasterStats data/default data/runtime/global data/runtime/tenants tokens actions commands sb plugin-exports tmp scripts
RUN npm run build:simple

FROM node:20-slim AS runner

ARG GITHUB_SHA=unknown
ARG GH_SHA=unknown
ARG BUILD_SHA=unknown
ARG SEAART_CLI_VERSION=v1.1.0
ARG SEAART_CLI_SHA256=5fee0662bf68b0997be951b1eedb0716fc0991945b462655e199c7ecbadd119a

LABEL GITHUB_SHA=$GITHUB_SHA
LABEL GH_SHA=$GH_SHA
LABEL BUILD_SHA=$BUILD_SHA

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y python3 python3-pip python3-venv ca-certificates curl && \
    python3 -m venv /opt/piper && \
    /opt/piper/bin/pip install --no-cache-dir piper-tts && \
    curl -fsSL "https://public.cdn.seaspark.ai/ai-tool/release/${SEAART_CLI_VERSION}/seaart-linux-amd64.tar.gz" -o /tmp/seaart.tar.gz && \
    echo "${SEAART_CLI_SHA256}  /tmp/seaart.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/seaart.tar.gz -C /tmp && \
    install -m 0755 /tmp/seaart /usr/local/bin/seaart && \
    rm -rf /tmp/seaart.tar.gz /tmp/seaart /tmp/seaart-mcp /tmp/skills && \
    rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/piper/bin:${PATH}"

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/app-urls.json ./app-urls.json
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
COPY --from=builder /app/pokemon-tcg-data-master ./pokemon-tcg-data-master
COPY --from=builder /app/tmp ./tmp
COPY --from=builder /app/scripts/bootstrap-runtime.js ./scripts/bootstrap-runtime.js
COPY --from=builder /app/scripts/migrate-discord-config-single-source.ts ./scripts/migrate-discord-config-single-source.ts
COPY --from=builder /app/scripts/disable-discord-log-mirror-history.ts ./scripts/disable-discord-log-mirror-history.ts
COPY --from=builder /app/docker-entrypoint.js ./docker-entrypoint.js
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 3000
ENTRYPOINT ["node", "docker-entrypoint.js"]
CMD ["npx", "tsx", "--tsconfig", "tsconfig.json", "server.ts"]
