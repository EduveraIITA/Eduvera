# OmniSchool Node backend

NestJS 11 + Fastify 5 API for the first OmniSchool vertical: student attendance and parent/student workflows. PostgreSQL is the only datastore; Kysely provides a strict typed query layer. The API preserves the React client's existing `/api/v1` contracts while keeping room for later School OS modules.

## What is implemented

- Signed, opaque cookie sessions backed by PostgreSQL; session tokens are stored only as SHA-256 hashes.
- Signed double-submit CSRF protection on every unsafe mutation, including login and registration. Demo-session bootstrap is the deliberate development-only exception.
- Scrypt password hashes, password quality validation, collision-safe normalized usernames, logout/session expiry cleanup, and pending-school onboarding for public registration.
- Active-membership + relationship tenant checks for every student object. Students see themselves, guardians see linked children, and staff act only inside their school.
- Parent/student aggregate screens, subject/daily attendance, gate events, timetable, diary acknowledgement/notes, notifications, leave workflows, and full-roster attendance register submission.
- Revision-checked and idempotent attendance commands, teacher correction reasons, principal lock/unlock controls, and immutable before/after correction history.
- A transactional event outbox, multi-instance-safe worker, PostgreSQL broker, authorized SSE replay, persistent attendance notifications, and targeted React cache refresh.
- Approved leave updates attendance on actual instructional timetable dates and recomputes subject aggregates without overwriting a recorded present/late state.
- Leave submission accepts JSON or one multipart request. A multipart request may contain `category`, `starts_on`, `ends_on`, `reason`, optional `student_id`, and one PDF/JPEG/PNG `file` up to 10 MB. Leave, authorization, audit, notifications, and document metadata commit together; staged files are removed on rollback.
- Guardian `clarify` records a same-state audit event and notifies the student. It never declines the request. An authorized guardian's own submission is immediately `authorized` and ready for school review.
- Generic Attendance Copilot provider boundary: deterministic `mock`, local `ollama`, or an OpenAI-compatible chat endpoint. All provider context is assembled from server-authorized PostgreSQL queries and bound to one student.
- PostgreSQL audit log, shared PostgreSQL rate-limit buckets, request IDs, security headers, CORS allowlist, Swagger/OpenAPI, liveness/readiness, static assets, and React history fallback.
- Cross-school constraint triggers and browser-role grant lockdown protect the relational graph even when an application check regresses.

## Local setup

Requires Node.js 22+ and PostgreSQL 14+.

```bash
cp .env.example .env
npm ci
set -a; . ./.env; set +a
npm run db:migrate
npm run db:seed
npm run dev
```

The seed workflow also requires Python 3.11+ and the PostgreSQL `psql` client. It generates and then non-destructively upserts a complete 200-student school cohort, example custom roles, the extra demo administrator and the non-production company operator. Use `npm run db:generate` to inspect the generated SQL and summary without changing PostgreSQL, `npm run db:seed:roles` to repair only role/operator demo records after migrations `032`–`033`, and `npm run test:seed` to run the relationship and transaction-safety checks.

Production-like compiled start:

```bash
npm run build
node dist/main.js
```

Set `SPA_DIST_DIR` to the React `dist` directory. Exact assets are served directly and `/`, `/login`, `/signup`, `/launcher`, `/parent/*`, `/student/*`, and onboarding paths return `index.html` for client-side routing.

## Demo accounts

The primary credential demo accounts use `OmniDemo@2026` (or `DEMO_PASSWORD` during seeding):

| Persona | Username | Email |
|---|---|---|
| Parent | `pooja.parent` | `pooja.sharma@example.test` |
| Student | `aarav.student` | `aarav.sharma@example.test` |
| Staff | `kavita.staff` | `kavita.mehta@example.test` |

The following synthetic identities receive random, unusable-as-demo passwords and are available
only through one-click personas when `DEMO_MODE=true`:

| Persona | Username | Email |
|---|---|---|
| School admin | `arjun.admin` | `arjun.rao@example.test` |
| Company operator | `company.demo` | `company.operator@example.test` |

Pooja is Aarav's primary parent and Ananya's registered guardian. Every seeded student has an active enrollment, primary guardian, complete two-month attendance history, subject totals, timetable, and operational data used by the student, parent, teacher, and principal screens. Aarav also has an authorization-pending medical leave, approved history, diary items, notifications, and school contact details.

## API and health

- Swagger UI: `/api/docs`
- OpenAPI JSON: `/api/schema`
- Liveness: `/healthz`
- PostgreSQL and live-event readiness: `/readyz`
- Release identity: `/releasez`
- Prometheus metrics: `/metrics` (Bearer `METRICS_TOKEN` in managed deployments)
- Versioned API: `/api/v1`

Core groups include `auth/*`, `students/*`, `attendance-records/*`, `leave-requests/*`, `diary/*`, `notifications/*`, `events/stream/`, `teacher/attendance/bulk/`, `attendance-registers/*`, `screens/parent/*`, `screens/student/*`, and `ai/attendance/query/`. Both canonical and trailing-slash API paths are accepted for client compatibility.

The `csrftoken` cookie is readable by the React client; send that exact signed cookie value in `X-CSRFToken`. The session cookie is `HttpOnly`. In HTTPS environments set `COOKIE_SECURE=true`, use a random 32+ character `COOKIE_SECRET`, and configure exact `ALLOWED_ORIGINS`.

## Verification

```bash
npm run typecheck
npm run lint
npm run build
DATABASE_URL=postgresql://localhost/omnischool_test \
MIGRATION_DATABASE_URL=postgresql://localhost/omnischool_test \
EVENT_DATABASE_URL=postgresql://localhost/omnischool_test npm test
npm audit --omit=dev
```

The integration suite starts the compiled Fastify app on a temporary local port.
Its guard rejects shared, remote, staging, production, or ambiguously named
databases, so `DATABASE_URL` must point to a disposable loopback database whose
name includes `test`. CI provisions, migrates, seeds, tests, and destroys that
database. Coverage includes auth/CSRF, role and relationship isolation, register
revision conflicts, retry idempotency, lock/unlock, leave-to-attendance updates,
authorized SSE replay, event deduplication, cross-school constraints, timetable
mutations, and the generic AI response contract.

## Docker

Run this from the repository root so the image can compile both React and Node:

```bash
docker build -f backend/Dockerfile -t omnischool .
docker run --rm \
  --entrypoint node \
  -e MIGRATION_DATABASE_URL="${MIGRATION_DATABASE_URL:?set MIGRATION_DATABASE_URL}" \
  omnischool dist/database/migrate.js
docker run --rm -p 8000:8000 \
  -e DEPLOYMENT_ENVIRONMENT=production \
  -e DATABASE_URL="${DATABASE_URL:?set DATABASE_URL}" \
  -e EVENT_DATABASE_URL="${EVENT_DATABASE_URL:?set EVENT_DATABASE_URL}" \
  -e COOKIE_SECRET="${COOKIE_SECRET:?set COOKIE_SECRET}" \
  -e METRICS_TOKEN="${METRICS_TOKEN:?set METRICS_TOKEN}" \
  -e ALLOWED_ORIGINS='https://school.example' \
  -e PUBLIC_URL='https://school.example' \
  -e RELEASE_SHA="${RELEASE_SHA:?set RELEASE_SHA}" \
  -e COOKIE_SECURE=true \
  -v omnischool-uploads:/app/storage/leave-documents \
  omnischool
```

The runtime container never applies migrations or demo data. Compose uses
explicit one-shot services for local migration and seeding; a managed
deployment must run the migration command once as its release step. Uploaded
documents require a durable volume or object-storage adapter before
horizontally scaled deployment.

## Operational notes

- PostgreSQL rate limits are shared across API instances. For very high request volume, replace this table-backed limiter with Redis or an edge gateway without changing controller contracts.
- Local filesystem uploads are transactional at the application/database boundary and cleaned on rollback. Production clusters should use encrypted object storage, malware scanning, retention rules, and signed download URLs.
- AI is read-only and advisory. Provider failures return `503`; no provider receives data for a student the current user cannot access.
- Run migrations with a dedicated deployment identity and use separate runtime credentials with only required table privileges in production.

## Event delivery and operations

The write path is deliberately database-first:

1. A command validates school, role, class/student relationship, expected
   register revision, and its `Idempotency-Key`.
2. Attendance/leave/timetable rows, audit history, aggregate updates, and an
   `event_outbox` row commit in one transaction.
3. Any API instance may claim unpublished rows with `FOR UPDATE SKIP LOCKED`.
   A singleton cursor serializes publication so the assigned delivery cursor
   follows commit/publication order even when business transactions finish out
   of order. Persistent notification creation and `pg_notify` occur atomically.
4. Every API instance listens on the PostgreSQL channel and delivers only to
   authorized user IDs connected to that instance.
5. Tabs for the same user elect one leader for the credentialed
   `/api/v1/events/stream/` connection and relay validated envelopes through a
   user-scoped browser channel. The versioned `v2-<delivery sequence>` cursor
   replays missed authorized events after reconnect and invalidates only
   allowlisted query scopes. Legacy/invalid cursors or a retention gap request one
   full cache sync rather than periodic polling.

The publisher retries individual failures with bounded backoff and dead-letters
exhausted rows so one poison event cannot block a batch. Cleanup advances the
replay floor atomically before deleting expired rows. Live and replay delivery
re-check current membership, guardian, and timetable-assignment authorization;
the audience stored on an outbox row is only a routing optimization.

The same worker scans each school in its own timezone after that school's
`attendance_submission_cutoff`. It emits a deduplicated
`attendance.register.overdue` alert only for scheduled instructional classes
whose register is still missing, targeting the assigned teacher and an active
school administrator. A dedicated maintenance lease throttles this scan across
instances without contending with the event publication cursor.

`DATABASE_URL` may use a Supabase transaction pooler for ordinary API queries.
`EVENT_DATABASE_URL` is mandatory in managed environments and must use a direct
connection or the session pooler: a transaction-pooler connection cannot retain
`LISTEN` state. `MIGRATION_DATABASE_URL` is mandatory for `db:migrate`, should
use the direct connection, and is held only by the release job. All remote URLs
must use `sslmode=require`, `verify-ca`, or `verify-full`. The validated
`DATABASE_POOL_MAX` range is 1–50; budget at least one event connection per API
process in addition to that pool. Managed deployments also require a unique
32+ character `METRICS_TOKEN`; monitoring clients send it as a Bearer token.
Tune `EVENT_BATCH_SIZE`, `EVENT_CLEANUP_BATCH_SIZE`,
`EVENT_BROKER_CONNECT_TIMEOUT_MS`, `EVENT_WORKER_INTERVAL_MS`,
`EVENT_REPLAY_LIMIT`, `SSE_MAX_CONNECTIONS`, and
`SSE_MAX_CONNECTIONS_PER_SESSION` from load-test data, not anticipated user
count alone.

Use [`load-tests/morning-attendance.mjs`](load-tests/morning-attendance.mjs) for
the bounded teacher-home/register read burst and optional SSE soak. It refuses a
non-loopback target without explicit HTTPS opt-in, hard-caps concurrency, rate,
duration, and response sizes, and has no attendance mutation path. Provision a
dedicated load-test teacher rather than using a real staff account.

The Supabase Data API is not part of the application data path. Migrations enable
RLS and revoke `anon`/`authenticated` table access so a browser cannot bypass the
NestJS authorization boundary. If Supabase Auth/Data API is introduced later,
add explicit school-membership policies and policy tests before granting either
role access; do not weaken the current lockdown as a shortcut.

Release order:

1. Back up the database and record the current migration version/checksums.
2. Run migrations once through `MIGRATION_DATABASE_URL` with the deployment
   identity, then verify `/readyz` and the expected `/releasez` commit.
3. Roll worker/API instances, then the immutable frontend assets.
4. Run authenticated smoke checks for teacher submit/correct, principal
   lock/unlock, parent/student notification, SSE reconnect, and approved leave.
5. Roll back application containers independently when needed. Database
   migrations are forward-only; restore into a separate database before a
   destructive recovery decision.

Monitor `/healthz`, `/readyz`, API latency/error rate, open SSE connections,
database pool saturation, unpublished outbox count, oldest unpublished event age,
and `event_outbox.attempts/last_error`. Alert on sustained outbox age or readiness
failure. Retain structured logs with request IDs and audit actor IDs, but never
session cookies, CSRF values, leave documents, or AI context.

For Supabase production, enable the backup/PITR tier appropriate to the recovery
objectives, include private leave-document storage in the same recovery plan, and
perform scheduled restore drills into an isolated project. A backup is not
considered operational until restore time and relationship-validation checks have
been measured.
