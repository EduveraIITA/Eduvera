# Institution directory and company onboarding

## Base branch and scope

This feature is based on `main` at `a6407743a3dca4088aca6d8eaddf5e59f33df2b6`.
That version has no company onboarding, company-operator authority, or invitation
service. This PR therefore includes a small separate company-operator grant,
institution detail screen, and expiring first-admin invitation flow. It does not
bring across unrelated changes from Stage. Coordinate integration with Stage's
newer company onboarding/role tables before merging those branches together.

## Runtime and access

- `/company`: company Super Admin → search → select → confirm → create.
- `/company/institutions/:schoolId`: view existing institution / continue setup /
  invite an administrator. It exposes institution metadata, not student data.
- `/join-institution`: signed-in recipient accepts a private invitation code.
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
node --import tsx src/institutions/company-operator.ts grant operator@example.com
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

New accounts are `setup_in_progress` until an invited administrator accepts;
they then become `active`. `suspended` is supported for backend-managed suspension
but this PR does not add a suspension-management UI. Invitations are hashed,
single-use, bound to recipient email, valid for 72 hours and invalidated by
replacement. Acceptance rechecks current company authority and account status.
Invitation issuance and acceptance are audited. In this main-based foundation,
invitations are **shared manually**: the UI never claims an email was sent. There
are no runtime email credentials or connections to the official datasets.

Existing schools at migration time receive unverified MANUAL directory entries
and active links. Existing internal school codes are not assumed to be official
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

The dedicated `Institution directory checks` workflow uses an isolated PostgreSQL
16 service and no staging/production credentials. It runs migrations, seeds the
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
invitation; confirm that the active result offers View institution; review a manual
duplicate warning before acknowledging a different campus.
