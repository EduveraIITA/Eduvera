# Google Cloud Stage

Target: `eduera-511111`, Mumbai (`asia-south1`). Reuse the team's Cloud SQL
instance **`eduera-db`** and Artifact Registry **`eduera/web`**. Do not create a
second database. Google Cloud is the verified Stage deployment target. The
existing Railway service remains an older snapshot/rollback option; its database
does not synchronize with Google Cloud.

## Delivery

`Stage` pushes run the existing isolated PostgreSQL tests, frontend tests, lint,
typechecks, builds and secret scan. The reusable Google Cloud job then builds an
amd64 container on GitHub and pushes its commit tag. Authentication uses OIDC,
not a downloadable service-account key. Trust is restricted to numeric repository
and owner IDs, the Stage ref, the Stage workflow and push/manual events. The
`gcp-stage` GitHub environment only allows the Stage branch.

When `GCP_STAGE_DEPLOY_ENABLED=true` in that environment, the job checks the
existing runtime limits, updates/runs the schema-migration job, deploys a candidate
without production traffic, verifies both applications and the exact release,
then promotes it. A post-promotion failure restores the previous application
revision. It never reverses database migrations or seeds demo data automatically.

The runtime must already have its database secrets, SQL connector, private upload
bucket mount, one-CPU/1-GiB limit, one-instance service cap and continuous CPU for
the background event worker. A missing or unsafe runtime fails closed. CI cannot
create databases, change IAM, expose buckets or upgrade billing.

The migration job must be `eduvera-stage-migrate`, one task, no retries, command
`node dist/database/migrate.js`, using `stage-migrator` and a Secret Manager
reference for `MIGRATION_DATABASE_URL`. The application uses `stage-runtime`.
Cloud SQL connections must point to `eduera-511111:asia-south1:eduera-db`.

## Trial safety

The user authorises using the existing $300 credit, not upgrading to a paid
account, GPUs or Marketplace products. `GCP_TRIAL_DEPLOY_UNTIL` is a reviewed
deployment-window deadline (initially 8 November 2026), **not** proof of the
account's trial expiry and **not** an automatic shutdown or spending cap.
Renew it only after reviewing remaining credit. Budget alerts are not hard caps.
The authenticated account cannot view the linked account's remaining trial credit.
The user confirmed the credit and authorised provisioning. A project-only monthly
**INR 250 early-usage alert** now exists, excluding credits, at 50/80/100 percent.
This deliberately small alert is not a USD 250 budget or a spending limit.
Runtime, storage and network costs continue independently of CI.

## One-time migration

An explicit Stage workflow dispatch with `bootstrap_google_cloud=true` copies
the current Railway connection URLs, cookie/metrics secrets and encryption key
into pre-created private Google secrets. Values are never written to Actions logs
or uploaded as artifacts. Temporary `secretVersionAdder` access is scoped to
those individual secrets and must be revoked after the copy. This dispatch does
not run the normal release or reseed anything.

Database copying, attachment inventory/copy, and consistency verification are
separate from the recurring release. Retain the existing encryption key when
copying encrypted records. Never overwrite the team's database or existing
schemas without checking them. Record snapshot time and any source-write gap;
an initial copy is not proof that two live databases remain synchronized.

## Current state

- App: https://eduvera-stage-367469594690.asia-south1.run.app (Stage/demo).
- The team's `eduera-db` now contains an initial, verified point-in-time copy of
  all 183 public application tables, 200 students and 64 migration records. All
  table row counts matched the exported consistent snapshot. No stored attachment
  rows existed. The source was not modified or continuously replicated.
- The initial database backup completed successfully (`1791548387012`). Database
  deletion protection and encrypted-only connections are enabled. Connections
  use the Cloud SQL connector, not a public IP allowlist.
- Private GCS upload storage passed create/exclusive-write/rename/read checks.
  The temporary probe files were removed, and its one-off job was deleted.
- Principal, teacher, parent and student WebKit checks passed login, navigation,
  320/390/1024px overflow checks and no page/server errors. The local Ollama model
  is not reachable from Google Cloud; cloud AI remains visibly unavailable as it
  was on Railway. No paid model endpoint or GPU was provisioned.
- `GCP_STAGE_DEPLOY_ENABLED=true` and `STAGE_DEPLOY_TARGET=google-cloud` are set.
  Railway is retained as the old snapshot/rollback service, not a second deployment
  target. [Push-triggered run 37930186905](https://github.com/EduveraIITA/Eduvera/actions/runs/37930186905)
  passed all checks, migrated, verified a candidate and promoted release
  `41c9aa537701a39fcd4ba635c0387b9468760578` to revision `eduvera-stage-00002-wik`.
  Independent public-release/readiness and four-portal WebKit checks passed on that
  release. Railway deployment was skipped. Normal pushes do not copy data or run
  demo seeds. A later documentation-only `[skip ci]` commit is not a new app release.
- The empty duplicate Cloud SQL instance `eduvera-stage` was **deleted**, with
  operation completion verified, at the user's request. `eduera-db` is preserved.
- The unused empty `eduvera-stage` image repository was also removed; images use
  the team's `eduera/web` repository. Temporary source-connection secret versions
  are disabled and the local migration proxy is stopped. The original source
  credentials and private migration snapshot remain recoverable for rollback.

References: [Google GitHub authentication](https://github.com/google-github-actions/auth),
[Cloud Run runtime contract](https://docs.cloud.google.com/run/docs/container-contract),
[trial restrictions](https://docs.cloud.google.com/free/docs/free-cloud-features),
[budget limitations](https://docs.cloud.google.com/billing/docs/how-to/budgets).
