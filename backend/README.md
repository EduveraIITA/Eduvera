# ThatCampus backend

NestJS/Fastify, TypeScript, Kysely and PostgreSQL 17 implement the domain services,
Campus Model Core, authenticated APIs and workers. Start with the
[current contracts](../docs/blueprint/README.md) and
[delivery state](../docs/blueprint/IMPLEMENTATION_PLAN.md), not historical portal
routes or old demo credentials.

## Setup and hosting

Requirements: Node 22.12+, PostgreSQL 17 and compatible client tools. Live, event and
migration connections target the intended application database; product Simulation
requires its own isolated store on the same server. No database/process per run.

```sh
cp .env.example .env
npm ci
# Review the exact database targets and private values first.
npm run db:migrate
node --env-file-if-exists=.env --import tsx --watch src/main.ts
```

`db:generate` produces reviewable Cambridge synthetic fixture output;
`db:seed` writes that development fixture through its current seed chain.
It also needs Python 3.11+ and `psql`. Do not seed a customer/shared database,
publish fixture passwords or fabricate attendance to satisfy an older test.

A compiled process uses `npm run build` then `npm start`.
`SPA_DIST_DIR` selects the compiled web directory. On the managed SSD preview,
`backend/dist` is watched: use a separate reviewed build directory and controlled
activation rather than compiling into the running tree.

| Endpoint | Purpose |
| --- | --- |
| `/healthz` | Process liveness |
| `/readyz` | Database and event readiness, not every product/provider dependency |
| `/releasez` | Immutable runtime identity |
| `/api/docs`, `/api/schema` | Current API specification |
| `/metrics` | Metrics; Bearer `METRICS_TOKEN` in managed deployments |
| `/api/v1` | Authenticated versioned application API |

## Security and effect boundaries

Browser sessions use signed opaque cookies with hashed server-side tokens.
Every unsafe browser command, including login/registration, requires signed
double-submit CSRF: send the `csrftoken` value as `X-CSRFToken`.
Managed deployments require secure cookies, strong independent secrets, exact
HTTPS origins, trusted-proxy review and non-demo authentication.

Domain APIs recheck active membership, responsibility/relationship authority,
target scope, revisions and invariants. Commands retain idempotency and immutable
audit/event evidence. Model Core coordinates domain execution; neither browser nor
Assistant gets direct database access. The Assistant's provider/cost settings are
server-controlled: the active local preview uses configured Vertex Gemini, while
`AI_*` legacy attendance-copilot and optional photo settings are separate adapters.
Do not infer active inference from example Ollama defaults or configure silent
provider fallback.

Private files need authenticated bounded access. Local transactional uploads are
not a horizontally scaled production storage plan: configure encrypted durable
storage, content/malware validation, retention and restore procedures first.

## Verification

Use focused owning files or `npm run test:fast` for routine feedback.
The fast lane contains reviewed source/logic tests with unreachable databases;
it does not replace full CI or isolated Simulation acceptance.

```sh
npm run typecheck
npm run lint
npm run test:fast
# Full suite: create and migrate/seed this fresh disposable local database first.
TEST_DATABASE_ISOLATED=true \
DATABASE_URL=postgresql://localhost/thatcampus_test \
MIGRATION_DATABASE_URL=postgresql://localhost/thatcampus_test \
EVENT_DATABASE_URL=postgresql://localhost/thatcampus_test npm test
```

`npm test` builds first; `test:ci` verifies conformance and runs already-built
tests. Default database tests remain serial because some alter process state.
Guards reject shared/remote/deployed or ambiguously named targets. Use fresh
loopback databases with a `test`/`ci` name; do not reuse a completed fixture as a
clean acceptance target. Provision/migrate/seed explicitly and remove only the
exact disposable databases afterward. Never relax isolation flags against Live.

See [verification limits](../docs/VERIFICATION.md#tests) and the bounded
[read-load harness](load-tests/README.md) before performance tests.

### Isolated Simulation suites

These opt-in tests create/drop schemas; the product suite resets its target
database. Use three distinct, disposable loopback databases owned by the test
role, with compatible `psql`/`pg_dump` on PATH:

```sh
createdb thatcampus_sim_source_test
createdb thatcampus_sim_world_store_test
createdb thatcampus_sim_product_store_test

DATABASE_URL=postgresql://localhost/thatcampus_sim_source_test \
MIGRATION_DATABASE_URL=postgresql://localhost/thatcampus_sim_source_test \
EVENT_DATABASE_URL=postgresql://localhost/thatcampus_sim_source_test npm run db:migrate

npm run build

SIMULATION_DATABASE_TEST_ISOLATED=true \
SIMULATION_TEST_SOURCE_DATABASE_URL=postgresql://localhost/thatcampus_sim_source_test \
SIMULATION_TEST_TARGET_DATABASE_URL=postgresql://localhost/thatcampus_sim_world_store_test \
npm run test:ci -- test/simulation-world.integration.test.ts

SIMULATION_PRODUCT_DATABASE_TEST_ISOLATED=true \
SIMULATION_PRODUCT_TEST_SOURCE_DATABASE_URL=postgresql://localhost/thatcampus_sim_source_test \
SIMULATION_PRODUCT_TEST_TARGET_DATABASE_URL=postgresql://localhost/thatcampus_sim_product_store_test \
npm run test:ci -- test/simulation-product.integration.test.ts

SIMULATION_LIFECYCLE_DATABASE_TEST_ISOLATED=true \
DATABASE_URL=postgresql://localhost/thatcampus_sim_source_test \
npm run test:ci -- test/simulation-lifecycle.integration.test.ts
```

Run suites sequentially if sharing the source. The source must also be disposable;
fixtures create/remove test tenants and may clear rate buckets. Test success is
not proof of ordinary mobile UI, real inference or every owning-domain workflow.

## Simulation operations

Simulation is maintained with every platform change. Review
`simulation:conformance:audit`, update adapters/tests and the reviewed revision,
then use `simulation:conformance:update`. Build/CI verify the source/schema/
frontend receipt. Never regenerate it simply to hide drift; capability evidence
gaps remain distinct from safety inventory.

Captures need `pg_dump` in the **API process** PATH, or absolute
`SIMULATION_PG_DUMP_PATH`. The client must support PostgreSQL 17 and not be older
than the source server. Launchd/container services do not inherit a terminal PATH.
Preflight rejects an unavailable/incompatible tool before reserving a fresh run;
accepted exact retries remain recoverable. This check is separate from `/readyz`.

Budgets and worker settings are in `.env.example`. Active/paused unbounded runs
have no wall-clock TTL. Pressure explicitly rejects admission or pauses retained
work; terminal retention defaults to 30 days. Pinning prevents ordinary removal.
One paged Saved list manages retained worlds, while history retains removed runs;
Compare explicitly enables selection. Draft discard is a revision/status-checked
native Stop followed by fenced cleanup, not an unchecked delete.

Cleanup refuses active, pinned, selected, leased or pending worlds and preserves
shared snapshots plus run history. `SIMULATION_GC_ENABLED=false` remains deliberate
until the deployment's retention policy/store are validated. Preparation recovery
uses DB time and its bounded timeout; it cannot expire an active indefinite run.
Released bytes are an accounting estimate, not an OS-space guarantee.

Retained worlds carry immutable semantic/schema compatibility manifests. Old,
tampered or incompatible worlds fail closed without a Live fallback; automatic
in-place upgrades are not implemented. Pause/Stop coordinate at safe checkpoint
boundaries. Large first reads can remain slow; see
[current evidence and limits](../docs/VERIFICATION.md#simulation).

## Event delivery and operations

Domain change, audit and typed outbox event commit together. Publication uses
transactional claims, commit-ordered delivery cursors, bounded retries/dead letters
and PostgreSQL LISTEN/NOTIFY. Authorized SSE replay rechecks current access; an
outbox audience is routing evidence, not an enduring permission grant. Browser
tabs elect one connection and relay allowlisted invalidations. Replay gaps request
a full scoped sync, not silent stale results.

`DATABASE_URL` can use transaction pooling for ordinary queries.
`EVENT_DATABASE_URL` must use a direct/session connection for LISTEN;
`MIGRATION_DATABASE_URL` uses a dedicated direct deployment identity.
Remote URLs require TLS. Budget pool capacity plus an event connection per process;
tune worker/replay/SSE settings from measurements, not predicted user totals.
Supabase browser roles have no application table grants; introducing its Data API
requires explicit reviewed membership policies, not weakening the current API boundary.

Release order: record a tested backup and migration checksums; apply forward-only
migrations once; verify candidate readiness/identity; roll API/workers/assets;
perform authorized workflow/Simulation smoke checks. Roll back binaries separately.
A destructive restore requires review and a separate recovery target; never erase
current Live or Simulation state as an application rollback shortcut.

Monitor readiness, latency/error rate, pool saturation, SSE connections, outbox
age/failures and worker recovery. Logs retain safe request/correlation IDs, never
cookies, CSRF tokens, documents, provider bodies or AI context. Back up database,
private files and encryption keys coherently and test isolated restores.

Docker builds from the repository root via `backend/Dockerfile`; its runtime
does not migrate/seed automatically. Compose uses explicit local one-shot jobs.
Managed deployments inject secrets and run migrations once through their release
identity. The separate [legacy Stage runbook](../deploy/gcp/README.md) is not the
active Digital Twin preview deployment.

## Native app session transport

Native sessions use the same hashed session store, memberships and selected
Live/Simulation context. Send `Authorization: Bearer <access_token>` with
`credentials: "omit"`; never mix cookies with the native token. Only a valid
native credential bypasses browser CSRF. Invalid Bearer credentials cannot fall
back to a browser cookie.

| Endpoint under `/api/v1/auth/native/` | Contract |
| --- | --- |
| `POST login/` | `{identifier,password}`; ordinary auth result plus opaque token, Bearer type and expiry |
| `POST mfa/login/` | `{challenge_token,code}`; MFA must succeed before session issuance |
| `POST register/` | `{email,password}`; token plus existing verification/onboarding result |
| `GET session/` | Bearer required; current auth/world/expiry, never echoes token |
| `POST logout/` | 204 only after durable revocation; expired/revoked token returns 401 |
| `POST password-reset/request/` | `{email}`; existing abuse-limited recovery |
| `POST password-reset/confirm/` | `{token,password}`; single-use proof and all-session revocation |

Use ordinary `auth/me/` for current memberships/permissions and
`auth/active-school/` to recheck/change campus. Existing MFA, session review,
revoke-others and environment controls accept native credentials.
Authentication remains Live control-plane state, not run-local campus data.

Store tokens in device-only Keychain/Android secure storage, bound to the configured
HTTPS API origin. Default session lifetime is 8 hours; no refresh token or indefinite
renewal is implemented. HTTP 401 requires sign-in. Cancel old requests and clear scoped
caches after account/campus/world changes. Unknown mutations retain their exact
command and owning recovery contract; this is not a general offline queue.
See [native scope](../mobile/PARITY.md) and [acceptance](../docs/VERIFICATION.md#native).
