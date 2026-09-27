#!/bin/sh
set -eu

node dist/database/migrate.js
if [ "${SEED_DEMO:-false}" = "true" ]; then
  node dist/database/seed.js /app/seed-data/medium-school.sql
fi
if [ "${DEMO_MODE:-false}" = "true" ]; then
  node dist/database/seed-operations.js
fi
exec node dist/main.js
