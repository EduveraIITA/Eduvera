# ThatCampus

ThatCampus coordinates the important work of an educational campus through one
responsibility-composed application. People, groups, places, resources and dated
operations share a Campus Model Core; domain services retain their own authority,
rules and evidence. Schools, colleges, universities, training centres and other
education providers use capabilities without separate persona portals.

The web shell is Today / Work / Areas / More, with the Assistant available through
the shared navigation. Product Simulation captures an isolated campus world and
uses the same domain services and ordinary screens in amber; Live remains blue.
Implemented capabilities and remaining gaps are not the same as the product target.

Owner decision, 29 October 2026: the React Native/Expo app is the sole frontend
under active development for browser, iPhone, iPad and Android. Features and fixes
are implemented there once. The old React/Vite application is frozen for reference
and reviewed rollback, with no parallel feature/fix or Vite maintenance. The owner
will retire it after active screens/actions, data links/history and
browser/simulator/emulator functionality and rollback are reviewed. The bounded
source audit covers all 129 active routes and its identified screen/control gaps
are ported; functional acceptance remains in progress. Physical-device checks are unavailable and explicitly not a
retirement prerequisite; hardware-only risks and store/distribution readiness
remain separate untested limits.

## Start here

- [Repository rules](AGENTS.md): safety, development boundaries and required reading.
- [Current contract map](docs/blueprint/README.md): authority order and domain owners.
- [Product blueprint](docs/blueprint/PRODUCT_BLUEPRINT_V2.md): accepted product direction.
- [Implementation record](docs/blueprint/IMPLEMENTATION_PLAN.md): delivered state,
  unresolved gaps and next work.
- [Verification](docs/VERIFICATION.md): acceptance evidence and practical limits.
- [Current-system atlas](docs/architecture/current-system-atlas/paper.md):
  descriptive architecture, data ownership and integration boundaries.

Read the owning contract and code before extending a workflow. Documentation
cleanup does not change product authority, historical migrations or operating data.

## Repository map

| Directory | Purpose |
| --- | --- |
| `frontend/` | Frozen React/Vite reference and rollback source; no active feature/fix maintenance |
| `backend/` | NestJS/Fastify, Kysely, PostgreSQL and domain/Model Core services |
| `packages/contracts/` | Shared web/native wire contracts and pure normalization |
| `mobile/` | Sole active React Native/Expo frontend for all four targets; [setup](mobile/README.md) and [scope](mobile/PARITY.md) |
| `marketing/` | Separate public website; [deployment and capture rules](docs/marketing/DEPLOYMENT.md) |
| `services/photo-attendance/` | Optional experimental inference sidecar |
| `deploy/` | Explicitly scoped deployment/integration tooling |
| `devtools/campus-simulator/` | Protected synthetic development harness, not product Simulation |

The Node API owns `/api/v1`, OpenAPI, authenticated files and the compiled web
fallback. PostgreSQL 17 is required, including compatible client tools. Live and
Simulation use separate databases on the same server; there is no server per app
or database per run.

## Local development

Requirements: Node 22.12+, PostgreSQL 17 and matching `psql`/`pg_dump`/`pg_restore`.
Python 3.11+ is needed only for the synthetic data generator and relevant tooling.

In `backend/`, copy `.env.example` to private `.env`, configure the intended
local databases and secrets, then run:

```sh
npm ci
npm run db:migrate
node --env-file-if-exists=.env --import tsx --watch src/main.ts
```

For the universal browser and native clients, follow [mobile setup](mobile/README.md).
The old `frontend/` is available for read-only reference or reviewed rollback,
not a parallel development server. On the maintained Mac, port 5173 belongs to
the managed React Native Web preview below.
Do not run migrations or seeds against an unreviewed target. `db:generate`
produces reviewable Cambridge fixture output; `db:seed` writes development data
and must be deliberately selected. No demo password belongs in this guide.

For Docker review, `docker compose up --build` provides the one-origin local
configuration. Compose defaults are demo-only, not a production deployment recipe.
See [backend operations](backend/README.md) for isolated tests, compiled hosting,
event delivery, Simulation and native authentication.

### This Mac's SSD preview

The active folder is `/Volumes/MacSSD/Projects/ThatCampus/digital-twin`.
The former Documents location is a compatibility symlink. User LaunchAgents
`dev.thatcampus.api`, `dev.thatcampus.web` and
`dev.thatcampus.cloudflared` own API 8000, the loopback web host on
`127.0.0.1:5173`, and the existing Cloudflare tunnel to that host. The public
preview is [the universal app](https://quit-cloth-shore-listing.trycloudflare.com).
Live development is active: the managed web host runs
`mobile/scripts/serve-web-preview.cjs --mode development --metro-origin 'http://[::1]:8084'`
with the existing port 5173 and exact public origin. It proxies only the bounded
Expo web/HMR surface to the existing Metro and retains the same-origin API 8000
cookie/CSRF owner; no Vite server is involved. The
[public activation](artifacts/native-web-ui-20261029/live-development-public-activation.json)
and [rendered Fast Refresh probe](artifacts/native-web-ui-20261029/live-development-hmr-source-probe.json)
confirm the signed-in public app and a component edit/restoration without reload,
with input retained and the owned test input then cleared. API configuration,
database history and the tunnel process are retained. Logs are `.runtime/ssd-*.log`.

`launchctl list | rg 'dev.thatcampus'` checks those jobs. Keep the SSD mounted
and Mac awake. Read the current temporary URL from
`.runtime/ssd-cloudflare.error.log`; hostnames can change after tunnel recreation.
A changed public origin requires review of the host's exact `--public-origin`
and API public-link/allowed-origin configuration. API configuration changes need a
reviewed restart. Never print private environment values. Quick Tunnel addresses
are temporary and do not support SSE; the current app uses ordinary HTTP polling.

Refresh an old frozen client once; supported universal source
edits then use Expo Fast Refresh. The single eager development bundle has a larger
initial load than a release export and is not production hosting. Static mode
remains for reviewed release exports and rollback. See
[the preview runbook](mobile/README.md#this-macs-managed-public-preview),
[18 HTTP/WebSocket checks](artifacts/native-web-ui-20261029/live-development-host-tests.log),
[real Metro probe](artifacts/native-web-ui-20261029/live-development-existing-metro-probe.json)
and [isolated candidate evidence](artifacts/native-web-ui-20261029/live-development-host-root-candidate.json).
All 29 parity groups remain implemented-unverified; changing the preview does not
retire the old implementation. Backend source requires a reviewed build/activation;
do not overwrite the watched `backend/dist` during an uncontrolled build.
The API LaunchAgent's PATH includes `/opt/homebrew/opt/postgresql@17/bin`;
a changed plist requires bootout/bootstrap. Do not start the older standalone
preview supervisor alongside these jobs.

## Verification and release

Start with focused owning backend tests or `npm --prefix mobile test` for the
active universal frontend. Old frontend tests may support a bounded migration
comparison; they do not reopen legacy feature/fix maintenance.
Full acceptance also includes typecheck, lint, builds, isolated database tests
and Simulation parity; a fast test or source inventory is not end-to-end proof.
[Backend verification](backend/README.md#verification) documents safe targets.
[Native scope](mobile/PARITY.md) separates source/build evidence from device acceptance.
The latest [In & Out checks](docs/VERIFICATION.md#in-out-ui) cover compact controls,
retained picker/camera drafts, explicit nested discard and note handoffs, with
bounded browser/iPhone rendering. The
[final receipt](artifacts/native-web-ui-20261029/in-out-live-final-verification.json)
records 1630 passing tests, TypeScript and web/iOS/Android exports from unchanged
reviewed sources. These checks do not establish all-workflow or Android gesture acceptance.

Useful API checks: `/healthz`, `/readyz`, `/releasez`, `/api/docs` and
`/api/schema`. Readiness does not prove provider inference, every Simulation
workflow or physical-device operation. The current local Assistant uses configured
Vertex Gemini; example/default legacy copilot settings are not the active provider.
Providers, credentials and paid inference remain server-controlled.

Keep tenant/authority checks, command revisions, idempotency and immutable evidence.
Changes to campus behavior require matching isolated Simulation verification.
The local preview is not the separate legacy Stage/marketing deployment; do not
deploy, synchronize or borrow from Stage to update this Digital Twin checkout.
