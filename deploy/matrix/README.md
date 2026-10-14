# Self-hosted Matrix for Eduvera — bridge increment

**Status: review implementation, not a deployed replacement for Messages.**

This change installs an opt-in outgoing Synapse bridge and prepares an isolated RTC
service bundle. PostgreSQL and the existing Eduvera chat API remain authoritative.
The React interface, attachments, reports, notification events and permission checks
remain unchanged. No school is opted in automatically. Do not use real learner data
until the release gates below have passed.

## Included

- Server-only Matrix application-service client; no Matrix credentials in browsers.
- Separate virtual identities per school/user and private, non-federated rooms.
- Transactional send/edit/redact outbox, ordered delivery, deterministic retry IDs,
  bounded backoff, revoked-member removal and author permission rechecks.
- Soft-deletion redacts delivered edits as well as the original Matrix event.
- Admin-only school opt-in with an authenticated Matrix health check and audit event.
- Existing authenticated attachment URLs remain behind Eduvera; there is no public
  media URL and no separate Matrix media upload.
- Dedicated worker; the web request never waits for Synapse network delivery.
- Docker Compose for Synapse/PostgreSQL plus disabled-by-default RTC lab services.

## Not included / do not advertise as working

This is **not yet the entire requested chat-engine migration**. It does not implement
Matrix-backed inbox reads, client sync/E2EE, incoming third-party Matrix clients,
historical backfill, Matrix read receipts, voice-note capture, the Element Call
widget host, request/accept/ringing, push delivery or a working end-to-end call.
The status endpoint deliberately returns `calls_enabled: false` and
`end_to_end_encrypted: false`. RTC containers alone do not implement those features.

The bridge stores an additional plaintext message copy in Synapse and immutable
payload snapshots in the outbox. Retention, hard-delete propagation, legal holds,
backup erasure and reconciliation of edits made while disabled must be completed
before live school use. Disabling the bridge does not erase existing copies.

## Local synthetic pilot

Use a Linux host with Docker Compose and Python 3. Run configuration generation as
a normal unprivileged user. No cloud resources are created by these commands.
Choose the permanent Matrix server DNS name carefully; it is part of user IDs.

```sh
cd deploy/matrix
python3 generate-config.py --server-name chat.example.test
# Generate signing keys without replacing the private generated configuration.
docker compose run --rm --entrypoint python synapse -m synapse.app.homeserver \
  --config-path /data/homeserver.yaml --generate-keys
docker compose up -d postgres synapse
curl --fail http://127.0.0.1:8008/_matrix/client/versions
```

Replace the example DNS name with one you control for a real deployment. The
Synapse API is bound to loopback, PostgreSQL is not published, and public/guest
registration, public directory and federation are disabled. Never expose
`/_synapse/admin` or the application-service token to the browser.

Generated secrets are in ignored `.env` and `runtime/` files (mode 0600). The one
exception is non-secret `element-call.json` (0644), which is a public client config.
The generator refuses to overwrite an existing runtime directory or secrets.
Do not commit these files or paste their contents into issues/PRs.

Build the current backend with its locked dependencies and apply migrations using
the existing migration procedure. Fill `runtime/worker.env` with the **pilot**
Eduvera database URL and the deployment environment/TLS settings required by
`backend/src/config.ts`; the generator deliberately leaves DATABASE_URL empty.
Then start the worker:

```sh
docker compose --profile worker up -d --build worker
```

For a locally running Eduvera API, set the four server-side variables from
`runtime/bridge.env`, replacing `MATRIX_INTERNAL_URL` with
`http://127.0.0.1:8008`. In Cloud Run, use Secret Manager for `MATRIX_AS_TOKEN` and
an authenticated/restricted HTTPS or private network route to Synapse. Do not use
`http://synapse:8008` from Cloud Run: that hostname is only inside Compose.
The API and worker must target the same Eduvera database and Matrix deployment.

Using an existing authenticated admin session and its CSRF token:

```text
PATCH /api/v1/chat/engine/schools/<school UUID>/
{"enabled":true}

GET /api/v1/chat/engine/conversations/<conversation UUID>/
POST /api/v1/chat/engine/conversations/<conversation UUID>/retry/
```

The opt-in endpoint is admin-only for the selected school; it cannot be used to
select arbitrary Matrix users or rooms. Opt-in starts with new message activity,
not a mass import. Existing Messages endpoints return optional `transport` and
`transport_state` metadata. `pending` means queued for the bridge, not delivered
or read by the recipient. The worker retains failing rows for retry.

## RTC preparation: NOT ready for school users

The `rtc-lab` profile pins Element Call 0.28.0, LiveKit 1.13.10 and
lk-jwt-service 0.8.0. It is deliberately not started by default. Web, signalling
and media ports are loopback-only; JWT service has no published port. The generated
RTC settings are local lab scaffolding, not a complete publicly routed calling site.

Before enabling calls, implement the Element widget host and server-authorized
call lifecycle, then configure HTTPS/WSS, correct publicly reachable media IP/UDP,
authenticated TURN, origin-limited iframe permissions, MatrixRTC discovery and
room-authorized JWT issuance. A local homeserver allowlist alone is not a room
permission check. Never grant students the application-service token or issue
unrestricted Matrix tokens as an integration shortcut.

For the current lk-jwt-service, prefer its documented Synapse application-service
wiring (MSC4502/MSC4512); it checks room membership through the homeserver. Review
compatibility with the pinned Element Call/Synapse versions before exposing it.
Do not enable guests or federation just to make the standalone call page log in.
Keep recording, transcription and video disabled for the audio pilot.

## Verification

```sh
# From repository root: standard-library configuration tests
python3 -m unittest discover -s deploy/matrix -p 'test_*.py' -v
cd backend
npm ci
npm run typecheck
npm run lint
npm run build
npx vitest run test/matrix-client.test.ts test/matrix-outbox.test.ts
```

The outbox tests refuse to write unless `TEST_DATABASE_ISOLATED=true` and
`DATABASE_URL` are both set. Use the existing Stage CI disposable PostgreSQL and
seed process; never point test commands at Stage's live database.

Locally verified when authored: 12 adapter contract tests (same source, Node test
runner adapter), five configuration tests, TypeScript syntax transpilation. Full
repo typecheck/lint, PostgreSQL tests, image pulls/boot, real Synapse delivery and
two-device audio remain separate unverified gates. No GCP deployment was performed.

## Release and rollback

Open a draft PR into Stage. Do not merge as a complete chat replacement. Require
full CI; real Synapse delivery/restart/duplicate tests; tenant and relationship
revocation tests; a storage/retention review; secret/backup recovery; and independent
role-by-role phone review. Native Matrix sync and working Element Call need a
subsequent implementation and their own acceptance evidence.

Set a school's `enabled` to false and stop its bridge delivery to roll back the
pilot. Set API `MATRIX_ENABLED=false` to remove bridge-dependent read metadata, and
stop the worker before removing its secrets. Keep databases/outbox for deliberate
reconciliation; do not drop volumes as a rollback shortcut. The old chat stays
available throughout.

## Upstream references and licenses

- Synapse application services: https://element-hq.github.io/synapse/latest/application_services.html
- Matrix Client-Server API: https://spec.matrix.org/latest/client-server-api/
- Element Call widget host: https://github.com/element-hq/element-call/blob/v0.28.0/docs/embedded_standalone.md
- Element Call self-hosting: https://github.com/element-hq/element-call/blob/v0.28.0/docs/self_hosting.md
- MatrixRTC authorization: https://github.com/element-hq/lk-jwt-service/blob/v0.8.0/README.md

Synapse and Element Call carry AGPL obligations; their upstream source and license
notices must remain available as required. No upstream AGPL source is copied into
Eduvera by this bridge. A license review is still required for the eventual
widget/SDK integration and any modifications; process separation is not a blanket
licensing exemption. Self-hosting avoids a mandatory chat-provider per-message fee,
not infrastructure or operations costs.
