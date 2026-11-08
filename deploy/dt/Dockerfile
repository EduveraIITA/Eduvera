# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f deploy/dt/Dockerfile .
# Audit-only retained frontend sources never enter the runtime image.
# Context isolation: https://docs.docker.com/build/concepts/context/
# Public build values: https://docs.expo.dev/guides/environment-variables/
FROM node:24-bookworm-slim AS backend-dependencies
WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM backend-dependencies AS backend-build
COPY backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/src ./src
COPY backend/scripts/verify-simulation-conformance.ts ./scripts/verify-simulation-conformance.ts
COPY backend/test ./test
COPY backend/migrations ./migrations
COPY frontend/src /build/frontend/src
COPY packages/contracts/src /build/packages/contracts/src
# Exact React Native sources and executable proof protected by the existing seal.
# They are build-time evidence only; runtime still copies compiled outputs alone.
COPY mobile/src/features/more/MoreToolBoundary.tsx /build/mobile/src/features/more/MoreToolBoundary.tsx
COPY mobile/src/features/SetupCommand.tsx /build/mobile/src/features/SetupCommand.tsx
COPY mobile/src/lib/more-tool-access.ts mobile/src/lib/api-policy.ts mobile/src/lib/device-storage-browser.ts /build/mobile/src/lib/
COPY mobile/test/more-tool-boundary-mounted.test.ts mobile/test/setup-command-browser-storage.test.ts /build/mobile/test/
# Keep the existing strict source/seal gate. Never regenerate a stale receipt here.
RUN npm run build

FROM node:24-bookworm-slim AS backend-production-dependencies
WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:24-bookworm-slim AS web-build
WORKDIR /build/packages/contracts
COPY packages/contracts/package.json packages/contracts/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY packages/contracts/src ./src
WORKDIR /build/mobile
COPY mobile/package.json mobile/package-lock.json ./
# npm ci runs the owning postinstall to generate dependency-matched CanvasKit.
COPY mobile/scripts/prepare-campus-skia-web.cjs ./scripts/prepare-campus-skia-web.cjs
RUN npm ci --no-audit --no-fund
COPY mobile/app ./app
COPY mobile/src ./src
COPY mobile/assets ./assets
COPY mobile/public ./public
COPY mobile/plugins ./plugins
COPY mobile/app.config.ts mobile/metro.config.js mobile/tsconfig.json ./
COPY mobile/scripts/web-api-proxy.cjs ./scripts/web-api-proxy.cjs
COPY deploy/dt/verify-web-export.mjs /build/deploy/dt/verify-web-export.mjs
ARG EXPO_PUBLIC_API_URL=https://app2.thatcampus.com
# Public values are intentionally bundled; no secrets or local .env files are read.
RUN node /build/deploy/dt/verify-web-export.mjs --origin-only "$EXPO_PUBLIC_API_URL"
RUN CI=1 EXPO_NO_DOTENV=1 EAS_BUILD_PROFILE=production NODE_ENV=production \
    EXPO_PUBLIC_API_URL="$EXPO_PUBLIC_API_URL" \
    npm run export:web -- --output-dir /build/web-dist
RUN mkdir -p /build/web-dist/licenses \
    && cp assets/fonts/FONT-LICENSE.txt /build/web-dist/licenses/DejaVuSans-LICENSE.txt
RUN node /build/deploy/dt/verify-web-export.mjs /build/web-dist "$EXPO_PUBLIC_API_URL"

FROM node:24-bookworm-slim AS runtime
# Official PGDG packages supply pg_dump17 and its matching shared libraries.
# https://www.postgresql.org/download/linux/debian/
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl --fail --silent --show-error --location \
       https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       --output /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && test "$(gpg --show-keys --with-colons /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc | awk -F: '$1 == "fpr" { print $10; exit }')" = "B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8" \
    && printf 'Types: deb\nURIs: https://apt.postgresql.org/pub/repos/apt\nSuites: bookworm-pgdg\nComponents: main\nSigned-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc\n' > /etc/apt/sources.list.d/pgdg.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-17 \
    && /usr/lib/postgresql/17/bin/pg_dump --version \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    SPA_DIST_DIR=/app/web-dist \
    UPLOAD_DIR=/app/storage/leave-documents \
    SIMULATION_PG_DUMP_PATH=/usr/lib/postgresql/17/bin/pg_dump
ARG RELEASE_SHA
ENV RELEASE_SHA=$RELEASE_SHA
LABEL org.opencontainers.image.title="ThatCampus Digital Twin" \
      org.opencontainers.image.revision=$RELEASE_SHA
COPY --from=backend-production-dependencies --chown=node:node /build/backend/node_modules ./node_modules
COPY --from=backend-production-dependencies --chown=node:node /build/backend/package.json ./package.json
COPY --from=backend-build --chown=node:node /build/backend/dist ./dist
COPY --from=backend-build --chown=node:node /build/backend/migrations ./migrations
COPY --chown=node:node backend/assets ./assets
COPY --from=web-build --chown=node:node /build/web-dist /app/web-dist
# The deployment must mount durable storage here; this only creates its mount target.
RUN mkdir -p /app/storage/leave-documents && chown -R node:node /app/storage
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
