FROM node:24-bookworm-slim AS frontend-dependencies
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM frontend-dependencies AS frontend-build
COPY frontend/ ./
RUN npm run build

FROM node:24-bookworm-slim AS desktop-dependencies
WORKDIR /build/frontend-desktop
COPY frontend-desktop/package.json frontend-desktop/package-lock.json ./
RUN npm ci

FROM desktop-dependencies AS desktop-build
COPY frontend-desktop/ ./
RUN npm run build

FROM node:24-bookworm-slim AS backend-dependencies
WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

FROM backend-dependencies AS backend-build
COPY backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/src ./src
RUN npm run build

FROM python:3.13-slim-bookworm AS seed-build
WORKDIR /build/backend
COPY backend/scripts ./scripts
RUN python3 scripts/generate_school_data.py --output generated/medium-school.sql --summary-output generated/medium-school-summary.json

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000 \
    SPA_DIST_DIR=/app/frontend-dist \
    STAFF_DIST_DIR=/app/staff-dist \
    UPLOAD_DIR=/app/storage/leave-documents
WORKDIR /app
RUN groupadd --system --gid 10001 omnischool \
    && useradd --system --uid 10001 --gid omnischool --home-dir /app omnischool \
    && mkdir -p /app/storage/leave-documents \
    && chown -R omnischool:omnischool /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=backend-build --chown=omnischool:omnischool /build/backend/dist ./dist
COPY --from=frontend-build --chown=omnischool:omnischool /build/frontend/dist ./frontend-dist
COPY --from=desktop-build --chown=omnischool:omnischool /build/frontend-desktop/dist ./staff-dist
COPY --from=seed-build --chown=omnischool:omnischool /build/backend/generated ./seed-data
COPY --chown=omnischool:omnischool backend/migrations ./migrations
COPY --chown=omnischool:omnischool backend/assets ./assets
COPY --chown=omnischool:omnischool backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod 0755 ./docker-entrypoint.sh
USER omnischool
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
