# Institution directory and company onboarding

## Base branch and scope

The original main-based PR is integrated with Stage's existing company console,
operator grants, invitation email delivery, `/join` account activation and institution
readiness workflow. Migration `053_institution_directory.sql` is additive; existing
applied migrations and the schools schema remain unchanged.

## Runtime and access

- `/company`: company Super Admin → search → select → confirm → create.
- `/company/institutions/:schoolId`: view existing institution / continue setup /
  invite an administrator. It exposes institution metadata, not student data.
- `/join`: existing Stage invitation acceptance flow (new or existing account).
- `GET /api/v1/institutions/search/?q=...`: public catalogue, with optional `type`,
  `state`, and `limit` (1–50, default 15). Requires 2–180 trimmed characters.
- All tenant creation, institution-detail reads and invitation issuance require
  an active company operator. Ordinary school admins do not have this authority.
  Writes retain the existing signed-session CSRF protection and rate limiting.
- Search returns institution type, source/code, verification, address/location,
  `is_onboarded`, `eduera_institution_id`, `onboarding_status` and `action`.
  It never returns invitation codes, admin email, metadata or student information.
- Search is case-insensitive and matches literal partial names, official codes,
  cities and districts. Ranking: exact name, name prefix, exact official code,
  partial official code, other partial matches; verified first within a tier;
  stable name/ID tie breaks. `%` and `_` are treated literally.

Grant company access to an existing active account through trusted backend access:

```sh
cd backend
npm run db:migrate
node --import tsx src/database/company-operator.ts grant operator@example.com
# Revoke with the same command, replacing grant with revoke.
```

Set `DATABASE_URL` in the execution environment. No credentials or demo operator
are committed. School admin roles and signup cannot grant company access.

## Identity, lifecycle and duplicates

`institution_directory` is a master dataset. `schools` remains the tenant table,
unchanged. `institution_onboarding` associates one directory record with one
school: a unique `directory_id` and primary-key `school_id` prevent either side
being assigned twice. Official `(source, source_code)` is unique. Codes are
uppercase/trimmed, required for official records, and null for manual records.

Creation locks the directory row, creates the school and link and writes an audit
event in one transaction. A second concurrent request waits, then receives HTTP
409 with the existing account. The unique constraint also protects direct SQL
callers. No orphan school survives a failed transaction. Suspended accounts retain
their identity and cannot be created again.

New accounts are `setup_in_progress` until Stage's readiness/activation workflow
publishes an active institution. Invitation acceptance alone does not activate it. `suspended` is supported for backend-managed suspension
but this PR does not add a suspension-management UI. Invitations are hashed,
single-use, bound to recipient email, valid for 72 hours and invalidated by
replacement. Acceptance rechecks current company authority and account status.
Invitation issuance and acceptance reuse Stage's audit trail and email transport.
The company console shows mail-server acceptance, delivery failure or private-code
fallback honestly. No parallel invitation or operator implementation is installed.

Existing schools at migration time receive unverified MANUAL directory entries
and links reflecting their existing activation status. All later school creation
paths also receive a manual fallback link through a trigger. Existing internal school codes are not assumed to be official
identifiers. Link them via the importer using an explicitly reviewed
`existing_school_id`; never use a name match as proof of official identity.
The old manual master entry is removed on relink to avoid a second selectable
result. No existing tenant name or operational data is overwritten by an import.

Manual creation requires name, type, state, district or city, and address. Exact
names and probable name/location matches produce a 409 with candidate accounts.
The operator must review and explicitly acknowledge the candidate IDs to proceed
for a different institution. Edits reset this acknowledgement in the UI. Name
similarity is only a warning, never an automatic merge or official match. Manual
creation is serialized through an advisory transaction lock so two concurrent
requests cannot both bypass the initial duplicate warning.

## Official dataset preparation and import

Use authorized exports from official sources. This repository neither downloads
nor scrapes protected portals, and does not include national dataset contents.
Official reference entry points:

- UDISE+ [Know Your School](https://kys.udiseplus.gov.in/home/) and
  [UDISE+](https://www.udiseplus.gov.in/).
- AISHE [Higher Education Institution Directory](https://dashboard.aishe.gov.in/)
  and [AISHE](https://aishe.gov.in/).

Normalize authorized data into UTF-8 CSV with this header:

```csv
name,institution_type,source,source_code,state,district,city,address,is_verified,metadata,existing_school_id
```

The first eight fields are required headers; location/address values can be blank
if absent from the official export. Optional `is_verified` defaults to `false`;
use `true` only for records whose provenance was validated. `metadata` defaults
to `{}`; use a JSON object with provenance, academic year and import/source date.
`existing_school_id` defaults to blank and is only for reviewed legacy mappings.

- `UDISE`: `school`, 11-digit string code (preserve leading zeroes).
- `AISHE`: `college` with `C-…`, `university` with `U-…`, or `standalone` with `S-…`.
- MANUAL entries are created by onboarding, not the official CSV importer.

```sh
cd backend
npm run directory:import -- /path/to/normalized.csv
```

The streaming parser handles BOM, CRLF, commas, escaped quotes and multiline
fields. The importer validates every record and upserts by source/code, preserving
the directory UUID and onboarding link. Metadata is merged; imported descriptive
fields are refreshed. One transaction makes an invalid file or conflicting legacy
mapping roll back the entire import. Missing records are not deleted or suspended.
Re-importing the same file is safe. Large exports can be split into reviewed
batches to keep transactions short. Explicit remapping of a tenant from one
official identity to another is rejected and needs separate operator review.

GIN trigram indexes cover names, codes, cities and districts; prefix and filter
indexes support name prefixes, state and type. PostgreSQL must permit `pg_trgm`
installation before migration. Two-character substring queries can be less
selective than longer queries; the API bounds responses and uses existing rate
limits. Confirm query plans with real imported data before national-scale rollout.

## Validation

The existing `Stage` workflow uses isolated PostgreSQL and no staging/production
credentials during verification. It runs migrations, seeds the
existing synthetic school fixture, runs existing backend integration/seed tests,
new directory/import/concurrency tests, frontend tests, lint, typechecks and builds.
Locally, the same backend checks need a disposable `DATABASE_URL`:

```sh
cd backend
npm run db:migrate
python3 scripts/generate_school_data.py
node --import tsx src/database/seed.ts
npm run typecheck && npm run lint && npm test && npm run test:seed
cd ../frontend
npm run typecheck && npm run lint && npm test && npm run build
cd ../frontend-desktop
npm run typecheck && npm run build
```

Manual UI review: check `/company` at mobile and desktop widths; search official
and manual entries; use arrow keys, Enter, Escape, Tab and outside click; select an
available institution and confirm; reopen it as setup-in-progress; accept an admin
invitation; confirm that the activated result offers View institution; review a manual
duplicate warning before acknowledging a different campus.

### Stage integration details

`POST /api/v1/company/institutions/` remains the creation endpoint. It accepts
`directory_id` or validated `manual` details plus the existing internal code,
timezone and first-admin email. The same transaction claims the directory record,
creates the school and audit records, and issues the existing Stage invitation.
Universities and standalone institutions retain their precise directory type and
use Stage's existing higher-education (`college`) workspace/capability pack.
Legacy company clients can still provide the original name/code/type/email body;
they receive an unverified manual directory record and the same duplicate check.
The new UI always collects complete manual location/address fields.

## Initial public snapshot import — October 2026

The Stage-only `Import public institution directory` workflow downloads the pinned
sources in `backend/scripts/institution-directory-sources.json`, verifies SHA-256,
normalizes them outside Git, validates against isolated PostgreSQL, then imports
through the existing Railway Stage connection. Dataset files are never committed.

- Schools: Ministry of Education / UDISE+ data redistributed by India Data Portal
  (Indian School of Business), **Open Data Commons Attribution License**.
  https://ckandev.indiadataportal.com/dataset/udise
  Resource last modified 30 September 2024; publisher's source-retrieval date is
  12 January 2022. This is not the latest national UDISE register.
- Higher education: AISHE-derived public snapshot published by **Brahmjot Singh**,
  **MIT license**, repository commit `0fc395ecb9d3e60d76ddeb9ce0d3853d4b52282e`
  dated 15 December 2025. Original extraction date is not supplied.
  https://github.com/BrahmjotSingh0/aishe-institutions-list
  The official AISHE dashboard was unavailable during retrieval; AIKosh's official
  export requires authenticated download access. This source is an independently
  published snapshot, not a freshly verified government export.

Each imported row is **unverified** and has a compact `metadata.snapshot` key
resolving to that source manifest. Search displays attribution and a staleness
notice. Blank addresses remain blank; village names are used as localities, not
invented street addresses. Ten-digit numeric UDISE codes regain the leading zero;
alphanumeric/unrecognized codes, names beyond the supported length, invalid
locations and conflicting AISHE identities are quarantined/count-reported.
Research-only AISHE `R-` codes are outside the supported directory types.

This initial snapshot loader uses a temporary staging table and one atomic insert
transaction. It **never overwrites an existing identity**, marks records verified,
creates tenants, sends invitations, or infers tenant links from names. Reruns are
idempotent. The regular normalized CSV upsert tool remains the path for reviewed
future official dataset updates and explicit tenant mappings. Validation counts
and complete source manifests are retained as a workflow artifact.

Local preparation (no database access):

```sh
python3 backend/scripts/prepare_institution_directory.py --directory /tmp/directory-sources --output /tmp/directory.csv
```

Run the Stage workflow or, from trusted Stage runtime access, invoke
`node --import tsx src/institutions/import-public-snapshot.ts /tmp/directory.csv`
from `backend`. Runtime credentials stay in the existing Railway/GitHub secret
boundary and are not logged or copied into Git. No account registration, protected
government portal scraping, or runtime dependency on an external directory is used.
