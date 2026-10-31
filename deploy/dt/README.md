# Digital Twin app2 deployment

The isolated web/API is live at `https://app2.thatcampus.com`. This runbook owns release operations for that target. The bounded checkpoint below separates the verified 212 deployment from the locally verified 213 performance preparation, installed native binary and still-open authenticated/performance/Simulation checks.

## Deployment boundary

`https://app2.thatcampus.com` is the isolated Digital Twin web and API origin. The `thatcampus-dt-edge` Cloudflare Worker accepts only that public host and forwards its method, path, query, authentication and request body to the reviewed `thatcampus-dt` Cloud Run service in `eduera-511111`, region `asia-south1`. It does not route the ERP or marketing hosts. The backend retains cookie/CSRF and native Bearer authority; the edge does not authenticate users or replace owning API checks. Edge transport failures return a safe JSON503 with different read versus unconfirmed-action copy, without replaying requests.

The single image contains the compiled backend, the sole `mobile/` Expo web export, production dependencies, required brand/font assets and PostgreSQL17 `pg_dump`. Retained `frontend/src` is an input to the unchanged Simulation source audit in the build stage only. No old frontend package, build or runtime enters the final image. Build-source upload filtering and the Dockerfile-specific allowlist exclude `.env`, credentials, local dependencies, private dumps, runtime state and verification artifacts before their respective upload/build boundaries. Use BuildKit; an image cache is not a substitute for the strict source gate.

Runtime is the non-root `node` user, UID/GID1000, working directory `/app/backend`, command `node dist/main.js`, listening on `0.0.0.0:8080`. `SPA_DIST_DIR=/app/web-dist`; uploads use `/app/storage/leave-documents`; `SIMULATION_PG_DUMP_PATH=/usr/lib/postgresql/17/bin/pg_dump`. Production builds explicitly set `EXPO_PUBLIC_API_URL=https://app2.thatcampus.com` and disable dotenv loading. Browser API calls remain same-origin. The backend serves Expo entry/chunk assets, fonts and the exact local CanvasKit WASM, including its license, with the reviewed CSP. Ordinary JavaScript `unsafe-eval` is not enabled.

## Isolated identities and state

These are identifiers, not credentials. Secret values must stay in Secret Manager and must not be pasted into this runbook, CI logs, source archives or shell history.

| Identity or resource | Purpose |
| --- | --- |
| `dt-builder@eduera-511111.iam.gserviceaccount.com` | Cloud Build and the isolated image repository |
| `dt-deployer@eduera-511111.iam.gserviceaccount.com` | Exact-branch release orchestration through short-lived GitHub OIDC/WIF impersonation |
| `dt-runtime@eduera-511111.iam.gserviceaccount.com` | Ordinary Cloud Run web/API and its scoped state/file access |
| `dt-migrator@eduera-511111.iam.gserviceaccount.com` | The exact one-task migration job |
| `asia-south1-docker.pkg.dev/eduera-511111/thatcampus-dt/app` | Immutable release images, resolved to a digest before deployment |
| `eduera-511111:asia-south1:eduera-db` | Existing shared PostgreSQL17 instance; no new database server |
| `thatcampus_dt` / `thatcampus_dt_simulation` | New, separate DT Live and Simulation databases with separate ownership |
| `eduera-511111-thatcampus-dt-files` | Private persistent file bucket |
| `eduera-511111-thatcampus-dt-build` / `eduera-511111-thatcampus-dt-backups` | Isolated source staging and controlled backup/initial-transfer artifacts |

The runtime references version-pinned secrets `thatcampus-dt-database-url`, `thatcampus-dt-simulation-database-url`, `thatcampus-dt-cookie-secret`, `thatcampus-dt-metrics-token` and `thatcampus-dt-restricted-case-key`. `EVENT_DATABASE_URL` uses the same secret and version as the new Live database. Only the migration job references `thatcampus-dt-migration-database-url`. Existing ERP secrets, database contents, services and traffic are outside this deployment.

The public origin and allowed browser origin are app2, with the distinct secure session cookie `thatcampus_dt_session`. Demo mode, public demo, profile switching and the hosted Campus Lab stay disabled. Production Simulation uses the same application/domain owners and the separate DT Simulation store; a hosting change does not establish exhaustive capability or isolation acceptance.

Resource guards require one service instance, bounded candidate revisions and always-allocated CPU. `DATABASE_POOL_MAX=4` is the current reviewed service/release guard and bounds each configured application pool; it is not a promise that the entire process uses only four connections. The initial pool 2 setting was replaced by the recorded pool 4 revision. Listener, lock, capture and per-world connections also count against the shared server budget. Concurrent candidate and migration activity must fit that budget. One running Simulation run, one lease and one worker run per poll are the initial hosted limits. Do not raise instance, pool or Simulation concurrency limits without reviewing the aggregate connection/resource budget.

Shared PostgreSQL capacity remains an open constraint. The inspected shared-instance samples report memory utilization 1.0 (100%) while CPU is about 22–24%; this is recorded pressure, not proof that every UI delay has the same cause. Workspace/native UI performance is still unresolved. Approval for a separate DT Cloud SQL instance remains pending; do not infer approval, provision it, resize the shared instance or alter the ERP target without explicit approval.

The private GCS bucket is mounted writable at the upload path with UID/GID1000 and explicit zero metadata-cache TTL. The recorded initial file transfer preserves relative keys. Before accepting persistence, require a write/read/rename/delete probe across separate executions plus an ordinary authenticated attachment upload/download; retain cleanup and permission evidence. A configured mount or copied object count alone does not prove that complete workflow.

## Initial establishment versus routine releases

The first establishment separately provisions the new identities, state, private buckets, service and migration job, and restores the reviewed source data into the new DT databases. It must not alter the old ERP or the maintained Mac development databases. An initial restore/import is a consequential, separately recorded action; never repeat it as a normal deployment step. Confirm its terminal result before ordinary workers or users are admitted. Copied Simulation records and sessions must be reviewed so a transferred active lease, worker or selected session cannot resume unnoticed.

Routine releases use `.github/workflows/digital-twin-deploy.yml` and `deploy/dt/release.mjs`. The script deliberately requires an already established, correctly bound service and migration job; it does not bootstrap arbitrary resources.

## Exact CI release sequence

The only deployment repository/ref is `EduveraIITA/Eduvera`, `refs/heads/codex/campus-digital-twin`, with the pinned repository/owner identities and exact workflow ref checked in source. Push and manual workflow dispatch on that branch are supported. Deployment concurrency is serialized and a running migration is never cancelled for a newer release. The deploy job uses the isolated `github-dt` WIF provider and short-lived impersonation of `dt-deployer`; no static service-account key is stored in GitHub.

1. Install locked backend, contracts and mobile dependencies. Run strict Simulation conformance, backend types/build and the reviewed whole-scope lint-debt gate, configured backend tests against disposable PostgreSQL17, the complete mobile suite, release/edge/container tests, and the production Expo export validator. The 212 workflow adds the six-file 42-case native identity/role/current-scope/COW/compiled-HTTP suite with the matching PG17 capture client, a fresh disposable Simulation database and a temporary compiled fixture removed in `finally`. The lint gate accepts only exact unchanged recorded debt; it is not a clean whole-backend lint claim. Do not regenerate a stale conformance seal simply to obtain a green build.
2. Preflight the existing exact Cloud Run service and migration job: identities, digest-based images, version-pinned secrets, new databases, bounded capacity and persistent-file binding must match the reviewed target.
3. Cloud Build creates the full-SHA-tagged image with BuildKit and the permanent app2 build origin. Continue only after a `SUCCESS` result supplies the exact Artifact Registry digest.
4. Deploy that digest as a uniquely named revision with the `dt-candidate` tag and **zero production traffic**. Re-read the actual service and verify the expected revision, bindings and tagged candidate URL.
5. Smoke the tagged candidate: exact `/releasez` SHA/production identity; `/readyz`; root and canonical deep-link HTML; actual Expo entry JavaScript; the exact CanvasKit bytes and MIME; reviewed WASM CSP; anonymous protected read returning 401; and native login `{}` returning owning JSON 400 without a session or cookie. This probe does not sign in or write campus data.
6. Update `thatcampus-dt-migrate` to the same immutable digest and exact `node dist/database/migrate.js` command. Execute **once**, one task, parallelism 1, retries 0, with an inspectable terminal success. A timeout/lost response is an unknown result to inspect, not permission to execute again.
7. Repeat candidate smoke after migration. Promote only the exact candidate revision to 100% traffic, remove the temporary tag, then repeat the same smoke through `https://app2.thatcampus.com`.
8. Retain `artifacts/dt-deploy/release.json` from the workflow artifact, including commit, digest, revision, build, migration execution and each smoke phase. A failed receipt records the phase and does not claim database rollback.

The pre-migration candidate check assumes an application/schema change that can start safely against the current schema. Plan incompatible schema changes as an explicit staged migration; do not skip smoke or weaken the release guard. The public smoke checks transport/asset/authentication boundaries, not every authenticated product workflow.

The automatic workflow deploys the backend and Expo web application. The fixed domain bridge is infrastructure; changes to its Worker code or custom-domain binding require a separately reviewed Wrangler deployment, and the pipeline does not imply that such a change was activated.

The approved Vertex provider uses service-account credentials and its existing bounded budget, enabled only until `2026-11-08T00:00:00Z`. No cloud inference acceptance is claimed here. Invitation email, Telegram, payments and photo external delivery remain disabled; configure and accept each real provider before relying on outbound delivery. Existing ERP provider secrets are not reused.

## Failure and rollback

Before promotion, a failed build, binding check, smoke or migration leaves the previous production traffic assignment in place. Stop and inspect the exact build/job/revision receipt; there is no general mutation retry wrapper. After promotion, a failed public smoke requires an operator decision: the script does not silently move traffic back.

Code rollback means directing the **new DT service only** to a retained, known-good DT revision/digest. First check that the older code can read the current schema and persisted data. If compatible, an operator may run the following after substituting the reviewed DT revision, then verify the public origin and retain the outcome:

```sh
gcloud run services update-traffic thatcampus-dt \
  --project eduera-511111 --region asia-south1 \
  --to-revisions '<reviewed-DT-revision>=100'
```

Traffic rollback does not undo a migration, restore a database, revert files or reverse accepted domain actions. Prefer repair forward when compatibility is uncertain. Any database restore requires its own exact-target review, backup/recovery plan, stopped/quiesced writers and explicit authorization; never restore over the old ERP or normal development databases. Do not repeat an uncertain migration or initial import to simulate rollback.

## Installed iPhone and later changes

A Release iPhone binary embeds JavaScript/assets and the app2 origin; Metro and the Mac tunnel are not required for that binary once cloud service checks pass. Build with the permanent HTTPS origin and inspect the embedded bundle before replacement installation. The native session policy accepts a saved credential only for the binary's normalized configured origin. A credential saved for the old tunnel is forgotten **locally** and app2 starts at sign-in; it is not sent to the new origin or revoked against the old server. The user's password is unchanged. Development builds retain their explicit server override.

After installation, verify app2 `/releasez`, sign in normally, confirm the current campus/world, and inspect API requests against app2. Installed-build, origin and sign-in evidence are separate from source tests. No Expo Updates delivery is configured; a new JavaScript/UI release requires a rebuilt/reinstalled native binary, while backend/web deploy independently.

The current device route is Apple Development/Personal Team distribution. Such provisioning profiles expire seven days after issuance, so a renewed signed build/install is needed; cloud hosting does not extend the profile. [Apple account guidance](https://developer.apple.com/help/account/basics/about-your-developer-account) documents this limit. TestFlight requires the appropriate active paid program/App Store Connect setup; the current account still has unresolved enrollment and no confirmed TestFlight upload. The existing Apple Support tab now shows a case confirmation; this does not establish paid membership or App Store Connect readiness. Do not label a Personal Team install as TestFlight delivery. See [Apple TestFlight](https://developer.apple.com/testflight/) and the existing mobile TestFlight runbook.

## Evidence checkpoint and pending acceptance

The following records bound current acceptance. Public readiness, static assets and authentication refusal probes do not establish authenticated product workflows or device performance.

| Check | Recorded result |
| --- | --- |
| Serving release | GitHub Actions run 41184964729 completed successfully. Release `9487168d421b4fe26c5b03f9d8176aa3f599c386` is live at app2 in revision `thatcampus-dt-r-9487168d421b-41184964729-1`, image digest `sha256:8f49ff927f01f79ff7189562ac1865e3096a5fc8ef2db8c87a9cce8d60d962f4`. The [full release receipt](../../artifacts/app2-cloud-deployment/ci-212/digital-twin-release-41184964729-1/release.json) records the build, single migration execution, candidate checks before/after migration and public smoke. This is conformance 212; the initial de1 image is historical. |
| Performance preparation213 | Independent review approves the attendance query and bounded retained-occurrence hydration. Native9 attendance cases and48 activity cases pass locally, with unchanged56-day scoring, current authority, captured rosters and selected-world isolation. The workflow now requires at least99 PostgreSQL cases with zero skipped/todo tests. Manual213 source conformance is reviewed; deployment and real cloud timing remain pending. |
| Forward migration 281 | The [fresh PostgreSQL receipt](../../artifacts/app2-cloud-deployment/role-source-forward-migration-receipt.json) reproduces 5/6 tests before migration 281 and 6/6 after it, then passes 42/42 with zero skips, strict conformance 212 and a temporary compiled application. Only seven local identifier uses change from `source_id` to `v_source_id` in the existing role-trigger function; its identity, owner, privileges, SECURITY INVOKER, search path and 15 triggers remain unchanged. Historical migration 270 is unchanged. |
| Old-world compatibility | The same 212 receipt proves ordinary `SimulationWorldService.open` refuses an old 211 capture with 409 `simulation_snapshot_incompatible`. Old snapshot/world/captured rows/functions are unchanged; there is no automatic world migration. Owned disposable databases, temporary build and private snapshot fixture were removed. This local proof is not readiness of the hosted restored worlds. |
| Source boundary and lint | The [Core port review](../../artifacts/app2-cloud-deployment/core-identity-independent-review.json) approves the eight runtime paths and 44 focused tests; the [full fast suite](../../artifacts/app2-cloud-deployment/core-boundary-fast-tests.log) passes 519/519. [Whole-scope lint](../../artifacts/app2-cloud-deployment/core-boundary-lint-gate.log) accepts 58 unchanged existing errors against 66 exact baseline entries, removes 8 fixed errors, and admits no new errors/warnings. This is `accepted-existing-debt`, not clean ordinary lint. [Deployment guards](../../artifacts/app2-cloud-deployment/deployment-guards-212.log) pass 41/41. |
| Mobile/parity | [Mobile tests](../../artifacts/app2-cloud-deployment/mobile-tests-final.log) pass 1822/1822. The [narrow inventory receipt](../../artifacts/iphone-network-recovery-20261031/narrow-source-acceptance.json) retains 49 unrelated source errors and 29 unfinished groups; hosting/source tests do not close parity or retirement gates. |
| Live and Simulation state | New DT identities/databases and Live transfer have receipts. Continuation `thatcampus-dt-initial-restore-22wz4` ended failed after its bounded child run; its [terminal result](../../artifacts/app2-cloud-deployment/restore-continuation-result.json) and [failure metadata](../../artifacts/app2-cloud-deployment/restore-continuation-failure.json) are retained. All table data had been restored before that postdata continuation. Remaining-object recovery and complete Simulation readiness are pending; a terminal failure is not permission to replay completed objects. |
| Persistent files | 92 relative keys were copied. The [private-file probe](../../artifacts/app2-cloud-deployment/file-storage-verification.json) passes closed write/rename, exclusive-write refusal, persistence across executions/instances and owned-probe removal. Ordinary authenticated attachment upload/download remains pending. |
| Capacity and workspace | Current service/release guards use pool 4 per configured pool, one service instance and bounded Simulation work. [Shared SQL samples](../../artifacts/app2-cloud-deployment/shared-database-capacity.json) show 100% memory utilization. UI/workspace performance remains unresolved; the public browser workspace still timed out while loading. Approval for a separate DT SQL instance remains pending, with no inferred answer or replacement provisioned. |
| Installed native binary | Permanent-origin native Release build 2 is [installed](../../artifacts/app2-cloud-deployment/ios-install.json); [origin](../../artifacts/app2-cloud-deployment/ios-origin.json) and [ABI](../../artifacts/app2-cloud-deployment/ios-abi.json) checks pass. It embeds app2 without the temporary tunnel. Fresh authenticated physical touring, mutations and smooth rendering are not accepted from installation. |
| Distribution | The existing Apple Support tab now shows a case confirmation. Paid enrollment/App Store Connect/TestFlight remain unconfirmed. Personal Team provisioning remains time-limited; no Expo Updates delivery is configured. |

Conformance212 deployment is verified; the213 performance preparation still needs its own completed CI/deploy receipt and authenticated latency checks. Keep Simulation restore, authenticated browser/native tours, ordinary attachment access, shared SQL capacity/performance and distribution as separate acceptance items. Do not promote an old-world compatibility refusal into an upgrade or delete retained worlds to make a check pass. Secret values and private database archives stay outside source.
