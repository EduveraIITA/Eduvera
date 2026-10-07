# Reviewed bulk student enrollment

Open `/principal/students/import` as a current school administrator. The workflow uses the
existing school UI and PostgreSQL records. It is an additive enrollment tool, not a mass-update
or account-provisioning tool.

## Workflow

Download the template, fill it in a spreadsheet, and save as UTF-8 CSV. Select the school and
active academic term before uploading. Files are bounded to 512 KB and 500 students. Files
with malformed CSV quoting or incorrect headers are rejected before a draft is created.

Review the per-row results. Fix a row in the app or explicitly skip it. Existing admission
numbers are never overwritten; a duplicate student should normally be skipped. Select an
existing guardian only after verifying the person. Search results are never auto-selected.

Resolve every error on included rows, read the warnings and select **Review enrollment**.
Confirm the included students, family relationships, effective dates and skipped rows. The
whole selected batch saves together or none of it saves. If another operator changes the
draft or school records, reload and review the updated results before confirming again.

## CSV columns

The template contains exactly these columns; column order may change, but names must match.
One CSV record represents one student and one primary guardian.

| Column | Meaning |
| --- | --- |
| `admission_number` | Unique within this school, case-insensitive; 2–64 letters/numbers/slashes/hyphens |
| `first_name`, `last_name` | Student name; last name may be empty |
| `date_of_birth` | Calendar date, `YYYY-MM-DD`, before enrollment and not in the future |
| `class` | Existing class label, e.g. `7A`, in the selected term's academic year |
| `roll_number` | Whole number 1–32767, unused in that class and term |
| `enrolled_on` | First roster date, `YYYY-MM-DD`, within the selected term |
| `guardian_key` | Optional explicit family reference within this file; letters/numbers/underscore/hyphen, up to 64 characters |
| `guardian_first_name`, `guardian_last_name` | New guardian's name; last name may be empty |
| `guardian_phone` | Contact phone for a new guardian |
| `guardian_email` | Optional guardian email |
| `relationship` | `mother`, `father` or `guardian` |

Use the same guardian key for siblings **only when it identifies the same verified guardian**.
The names, phone/email or selected existing guardian must agree across that group. A blank
key creates a separate guardian for each new row. Explicitly choosing the same existing
guardian links that person without creating another record. A name/phone match only produces
a warning; it is not proof of identity.

Selecting an existing guardian in the row editor uses the verified school record, rather than
the CSV's new-guardian contact fields. CSV import never grants leave-signing permission.
Manage that separately through the guardian permissions review.

## Records and attendance

Saving creates complete student/person, guardian/person, relationship and enrollment links
with school-scoped foreign keys. Accounts are optional. Subject attendance starts with zero
recorded classes; no attendance observations or marks are invented.

Enrollment dates determine when students enter teacher rosters. An affected submitted register
returns to draft with its marks preserved and a roster-change audit. An affected locked register
prevents the batch from saving. Reopen it through the existing workflow or correct the start date.

## Reliability, history and privacy

- Current administrator membership is checked on every API, including final commit/retry.
- Writes and relevant events commit in the same database transaction. Batches use ordered
  locks and bounded batched inserts; no remote calls occur inside the transaction.
- Upload retries reuse an upload key; final retries reuse the reviewed revision/token and return
  the saved receipt. A changed payload cannot reuse a previous command as a new operation.
- Row edits reject stale revisions. Final validation is repeated under locks and compared with
  the reviewed snapshot, including guardian selection and register changes.
- Draft changes notify only the school's administrators. Final class events notify authorized
  administrators, assigned teachers and linked guardian accounts. Event payloads contain IDs,
  not imported contact data. Consumers use the existing query-cache invalidation mechanism.
- Audit entries attribute staged uploads, row edits, cancellation and committed enrollment;
  sensitive raw CSV rows are not copied to the audit payload.
- Drafts expire after 24 hours. A periodic bounded sweep clears expired raw rows; opening a
  specific expired draft also clears it immediately. Cancel/commit clear raw input immediately.
  Minimal batch history and committed enrollment references remain. Database backups have
  their own retention lifecycle; clearing a draft does not erase earlier backups.
- Reports require the same school permission, use `Cache-Control: no-store`, and neutralize
  spreadsheet formula prefixes. Downloads are intentionally user-initiated and contain school data.

## Boundaries

This version accepts CSV, not XLSX or arbitrary column mappings. It requires existing terms and
classes. It creates a primary guardian per row, not a second-parent/custody import. Additional
family links, school-record corrections, login invitations, transfers, withdrawals and production
non-owner RLS/backup retention policies are separate workflows. No automatic rollback deletes
already-enrolled people; follow-up correction must preserve operational history.

Tests use an isolated school and include both 200- and 500-student batches. Local timings are
not a production performance guarantee. A managed Postgres capacity/load test and real school
process validation are required before rollout.
