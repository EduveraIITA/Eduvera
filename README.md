# OmniSchool — Edura attendance vertical

OmniSchool is being built as a complete School OS. This repository contains the
first vertical: student, parent, teacher, and principal attendance and timetable
operations, leave, diary, secure accounts, notifications, and an attendance AI assistant. The visual language is
implemented from the supplied Stitch screens; product behavior that was not
shown in those screens (authentication, authorization, loading/error/empty
states, navigation, exports, and workflow integrity) is implemented explicitly.

The application runtime is TypeScript end to end, with a reproducible Python data generator for development and review environments:

- `frontend/` — React 19, TypeScript, Vite, TanStack Query, accessible responsive UI.
- `backend/` — NestJS 11 on Fastify 5, TypeScript, Kysely, PostgreSQL, OpenAPI.
- `backend/scripts/generate_school_data.py` — deterministic, relationship-validated medium-school fixture generation.
- `compose.yaml` — one-origin production-style image plus PostgreSQL.

Attendance, leave, timetable, and notification changes use a transactional
outbox. The record change and its event commit in the same PostgreSQL
transaction; a horizontally safe worker claims events with `SKIP LOCKED`,
fans them out through PostgreSQL `LISTEN/NOTIFY`, and the open tabs for one
signed-in session elect a single SSE leader across both the main and `/staff`
React bundles. Validated events are relayed to the other tabs, and each bundle's
React query cache refreshes only the affected views.
Commit-ordered, versioned delivery cursors provide authorized replay after a
disconnect, with a bounded full-sync fallback when the replay window is exceeded.

The Node server is the sole backend. It owns `/api/v1`, health/OpenAPI routes,
authenticated uploads, and the compiled React history fallback.

## Quick start

Requirements: Docker with Compose v2.

```bash
docker compose up --build
```

Then open <http://127.0.0.1:8000>. Useful service routes:

- Liveness: <http://127.0.0.1:8000/healthz>
- PostgreSQL and live-event readiness: <http://127.0.0.1:8000/readyz>
- Swagger UI: <http://127.0.0.1:8000/api/docs>
- OpenAPI JSON: <http://127.0.0.1:8000/api/schema>

Compose defaults are deliberately local/demo-only. Its one-shot `migrate` and
`seed` services finish before the web service starts. For a real HTTPS
deployment, use the release workflow and managed secrets rather than these
development defaults.

## Demo access

| Persona | Username | Password | Landing page |
|---|---|---|---|
| Parent | `pooja.parent` | `OmniDemo@2026` | `/parent/home` |
| Student | `aarav.student` | `OmniDemo@2026` | `/student` |
| Teacher | `kavita.staff` | `OmniDemo@2026` | `/teacher` |
| Principal | `meera.principal` | `OmniDemo@2026` | `/principal` |

The login screen also offers explicit parent, student, teacher, and principal
demo buttons when `DEMO_MODE=true`. The shared Railway Stage test server keeps
this flag enabled; production rejects it at startup. Routes never silently
impersonate a demo user. Public signup
creates a secure account in `pending_school_membership`; it exposes no school or
student records until an administrator links it to a school.

## Implemented web routes

| Parent experience | Student experience | Teacher experience | Principal experience |
|---|---|---|---|
| `/parent/home` | `/student` | `/teacher` | `/principal` |
| `/parent/attendance` | `/student/attendance` | `/teacher/attendance` | `/principal/attendance` |
| `/parent/leave` | `/student/attendance/eligibility` | `/teacher/timetable` | `/principal/timetable` |
| `/parent/diary` | `/student/leave/new` |  |  |
| `/parent/timetable` | `/student/leave` |  |  |
|  | `/student/timetable` |  |  |
|  | `/student/timetable/week` |  |  |
|  | `/student/copilot` |  |  |

The launcher names the broader School OS modules. Modules outside this attendance
pilot are clearly marked planned and do not expose fake working controls.

## Local development

For the source-built, single-origin macOS review server:

```bash
node scripts/local-preview.mjs start
node scripts/local-preview.mjs status
# Only needed after changing preview scripts or environment:
node scripts/local-preview.mjs restart
# Stop deliberately:
node scripts/local-preview.mjs stop
```

This launchd service uses `backend/.env`, requires a local PostgreSQL URL, keeps
rate limiting enabled in memory, and runs a live Vite app on port `8000` with the
NestJS API behind it on port `8001`. React and CSS edits hot-update in the
browser; backend TypeScript edits are watched by the API process. Restart the
service only after changing preview scripts, environment, dependencies, or the
database process itself. It lasts for the current macOS login session; run
`start` after a reboot/login. Logs are in `.runtime/preview.log` and
`.runtime/preview.error.log`. The Mac and PostgreSQL must remain running. It does
not start or expose an ngrok tunnel.

The [blueprint implementation plan](docs/blueprint/IMPLEMENTATION_PLAN.md) tracks
the September 2026 blueprint, current gaps, domain boundaries and UI checkpoints.
The first added workflow is attendance follow-up: raise a question from a saved
teacher register, respond from Parent Home (or record a phone/paper response as
staff), then record an outcome from the staff home inbox. Replies do not modify
attendance. This is a local review slice, not completion of the entire School OS.

The principal's **Students & guardians** screen at `/principal/students` adds reviewed individual
enrollment: select or create a guardian, verify the relationship, review, then save atomically.
Students and guardians do not need login accounts. Effective enrollment dates protect old
registers; submitted registers affected by a roster change return to draft, and locked registers
block the change. No attendance marks are generated. Account invitations and authority
management beyond leave signing remain subsequent blueprint work.

**Bulk enrollment** is available at `/principal/students/import`: upload up to 500 CSV rows,
resume the draft, correct or skip rows, resolve guardian identity explicitly, review the batch,
and save all included students atomically. It includes private correction reports, persisted
receipts, import history, conflict-safe retries and expired-draft cleanup. See the
[bulk enrollment guide](docs/blueprint/BULK_IMPORT.md) for the CSV contract and operational limits.

Each guardian also has **Manage permissions** for school-verified leave signing. Principals can
review a dated grant or revoke it immediately, with revision checks, retry-safe commands and
history. The server enforces current authority on leave submission/signing. This does not alter
family links, record access, previous signatures or physical collection authority.

Use PostgreSQL 14+ (including `psql`), Node.js 22+, and Python 3.11+.

```bash
cd backend
cp .env.example .env
npm ci
set -a; . ./.env; set +a
npm run db:migrate
npm run db:seed
npm run dev
```

`db:seed` non-destructively upserts a realistic Cambridge International School cohort: 200 students in eight sections, a primary guardian relationship for every student, 17 teachers/staff, one principal, two months of daily attendance, subject totals, conflict-free weekly timetables, gate events, leave workflows, diary activity, and notifications. The generator validates the graph before producing SQL; PostgreSQL repeats the critical checks inside one transaction. Run `npm run db:generate` when you only want the reviewable SQL and JSON summary without loading the database.

In another terminal:

```bash
cd frontend
npm ci
npm run dev
```

Vite serves <http://127.0.0.1:5173> and proxies `/api` to port 8000 by default.
The managed local preview overrides this to serve Vite on port `8000` and proxy
API/health routes to the watched backend on port `8001`. For the single-origin
build, run `npm run build` in `frontend`, set `SPA_DIST_DIR` in the backend to the
absolute `frontend/dist` path, and run `npm run build && npm start` from
`backend`.

## Authentication, authorization, and workflow integrity

- Passwords use Node's scrypt with per-password salts.
- Browser sessions are opaque signed cookies; only SHA-256 token hashes are kept
  in PostgreSQL. Session cookies are `HttpOnly`.
- Unsafe requests use a signed double-submit CSRF token, including login and
  registration. The explicit demo bootstrap is disabled outside demo mode.
- Every student lookup is scoped by active school membership plus the direct
  student account, guardian relationship, current teacher timetable assignment,
  or administrator role. Identifiers from the browser are never trusted without
  this check.
- Leave changes are validated state transitions with audit records. Student
  multipart submission writes the request and supporting document atomically;
  guardian clarification is non-destructive; guardian-originated leave is
  immediately guardian-authorized for school review.
- API errors include a request ID. Rate-limit buckets are shared in PostgreSQL.
- Attendance submission is a full-roster, revision-checked, idempotent command.
  Submitted registers can be locked by a principal; corrections retain the old
  value, new value, reason, actor, and time. Approved instructional-day leave
  becomes excused attendance without overwriting a recorded present/late state.
- Teacher membership, timetable assignment, and the active roster are locked and
  revalidated inside that command transaction, so an already-open screen cannot
  bypass a concurrent revocation or enrollment change.
- Attendance scores give present/late a weight of `1`, half-day `0.5`, and absent
  `0`; excused records are excluded from the denominator. Subject totals are
  rebuilt from actual timetable periods, including checkout-aware half days.
- Each school has its own timezone and register-submission cutoff. A
  cross-instance-throttled worker creates one deduplicated overdue alert for the
  assigned teacher and school administrator when a scheduled register is late.
- Notification history uses indexed keyset pagination and returns an authoritative
  per-user unread total; the badge is never inferred from another role's records
  or only the visible page.
- Database constraints reject cross-school relationship graphs. Browser-facing
  Supabase Data API roles have no table grants; authenticated school data is
  served only after NestJS membership and student/guardian/staff checks.

See [`backend/README.md`](backend/README.md) for the API and operational detail.

## Attendance Copilot

The AI boundary is provider-neutral:

- `AI_PROVIDER=ollama` uses local Ollama (the development default in Compose).
- `AI_PROVIDER=mock` is deterministic for tests and offline development.
- `AI_PROVIDER=openai-compatible` uses a configurable compatible chat endpoint.

For local Ollama:

```bash
ollama serve
ollama pull qwen3:8b
ollama pull qwen3-vl:4b-instruct
```

Set `OLLAMA_BASE_URL=http://127.0.0.1:11434` and `OLLAMA_MODEL=qwen3:8b` for a
host-run backend. The server—not the browser—builds bounded attendance context
after authorization. The assistant is read-only and advisory.

Photo-assisted attendance uses a separate local vision-language model so it can
accept images without changing the text copilot. Set
`PHOTO_ATTENDANCE_OLLAMA_URL=http://127.0.0.1:11434` and
`PHOTO_ATTENDANCE_OLLAMA_MODEL=qwen3-vl:4b-instruct`.

## Verification

```bash
cd frontend
npm run typecheck
npm run lint
npm test
npm run build

cd ../backend
npm run typecheck
npm run lint
npm run build
# Tests deliberately refuse shared, remote, staging, or production databases.
DATABASE_URL=postgresql://localhost/omnischool_test \
MIGRATION_DATABASE_URL=postgresql://localhost/omnischool_test \
EVENT_DATABASE_URL=postgresql://localhost/omnischool_test npm test
npm audit --omit=dev

cd ..
docker compose config --quiet
```

Backend integration tests require a disposable local PostgreSQL database whose
name includes `test`. They cover session/CSRF behavior,
pending onboarding isolation, tenant-scoped parent/student data, timetable and
notification contracts, clarification invariants, atomic file uploads and
downloads, guardian auto-authorization, teacher register submission, principal
RBAC and locking, revision conflicts, idempotent retries, immutable corrections,
approved-leave attendance, authorized SSE replay, duplicate events, cross-school
database constraints, timetable create/update/delete, class ranking, and the
generic AI response. CI creates and destroys this isolated database automatically.

The bounded, read-only morning traffic harness and its remote-target safety
controls are documented in
[`backend/load-tests/README.md`](backend/load-tests/README.md).

## Share a local build with ngrok

Start the compiled one-origin app on port 8000, then:

```bash
ngrok http 8000
```

For HTTPS sign-in, restart the backend with the exact ngrok origin in
`ALLOWED_ORIGINS` and `COOKIE_SECURE=true`. Keep `TRUST_PROXY=true`; never use a
wildcard production origin.

## Production notes

The Docker image builds both applications, runs as UID/GID `10001`, contains
only production Node dependencies and compiled artifacts, and never mutates the
schema at application startup. Apply migrations once through
`MIGRATION_DATABASE_URL` before rolling API instances. With Supabase,
`DATABASE_URL` may use transaction pooling, but `EVENT_DATABASE_URL` must use a
direct or session-pooler URL because `LISTEN` needs a persistent session;
`MIGRATION_DATABASE_URL` should use the direct URL. Every remote URL must enable
TLS with `sslmode=require` or stronger. Replace the local upload volume with
encrypted private object storage and malware scanning, use a managed secret
store, back up PostgreSQL and documents together, and monitor `/readyz` plus
outbox age/failures. The deployment, recovery, and event-delivery runbook is in
[`backend/README.md`](backend/README.md#event-delivery-and-operations).

The Stage workflow disables passwordless demo impersonation and verifies an immutable release ID at `/releasez` before it
accepts a deployment. Initialize its Railway project and exact GitHub variables
with `deploy/railway-bootstrap.py` after installing
`deploy/requirements.txt`. The bootstrap requires separate runtime, event, and
migration PostgreSQL URLs plus stable random `COOKIE_SECRET` and
`METRICS_TOKEN` values; it never stores the migration identity in the
application service.

## Product and architecture blueprints

The primary development baseline is
[`School_Operations_Blueprint.pdf`](School_Operations_Blueprint.pdf) (v1.0, 15 September 2026).
Use the [implementation record](docs/blueprint/IMPLEMENTATION_PLAN.md) for current
delivery evidence, accepted decisions, dependency order, and remaining gaps.

The repository also includes the broader Eduvera planning documents:

- [`01_DESIGN.md`](01_DESIGN.md)
- [`02_TECHNICAL_ARCHITECTURE.md`](02_TECHNICAL_ARCHITECTURE.md)
- [`03_PRODUCT_FUNCTIONALITY.md`](03_PRODUCT_FUNCTIONALITY.md)
- [`04_FLOW_DIAGRAMS.md`](04_FLOW_DIAGRAMS.md)
