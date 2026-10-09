# Google Cloud Stage

Target: `eduera-511111`, Mumbai (`asia-south1`). Reuse the team's Cloud SQL
instance **`eduera-db`** and Artifact Registry **`eduera/web`**. Do not create a
second database. The existing Railway service remains the source/rollback until
Google Cloud verification and cutover are recorded.

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
The authenticated account currently cannot view the linked billing account;
the first budget-create request failed. No budget or verified credit balance is
claimed. Runtime, storage and network costs continue independently of CI.

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

Workflow and contract tests are prepared locally. Runtime deployment, source
copy, GitHub federation execution and public smoke checks still require evidence.
The duplicate `eduvera-stage` database created during concurrent team setup is
being removed at the user's explicit request; preserve `eduera-db`.

References: [Google GitHub authentication](https://github.com/google-github-actions/auth),
[Cloud Run runtime contract](https://docs.cloud.google.com/run/docs/container-contract),
[trial restrictions](https://docs.cloud.google.com/free/docs/free-cloud-features),
[budget limitations](https://docs.cloud.google.com/billing/docs/how-to/budgets).
