# Connected student enrollment lifecycle

Status: locally implemented first slice; local migration and database verification pass; physical UI
acceptance and deployment are pending. Blueprint authority: `School_Operations_Blueprint.pdf` v1.0, especially the
capture-once people model, explicit authority, audit and event propagation requirements.

## Product intent

A student is one durable school-scoped person record. Class placement changes must update the places
that consume the roster without forcing staff to re-enter the learner or losing the history that makes
attendance, assessment, finance and safeguarding evidence trustworthy.

This is deliberately part of **Students & guardians**. It is not a new module, a duplicate class roster,
or an invitation to merge people by similar names or phone numbers.

## Supported decisions

| Decision | Result | Preserved |
| --- | --- | --- |
| Move class | End current placement today and create a new active placement in another class in the same term | Old placement, marks, results, guardian links, fees, transport and departure records |
| Withdraw | End current placement today with an audited reason | Student identity and all historical/financial/relationship records |
| Transfer out | End current placement today and distinguish departure to another institution | Same durable history as withdrawal |

Bulk next-term progression continues through **Promote class**. This flow rejects a target term change so
operators cannot accidentally bypass the existing promotion review. Future-dated lifecycle scheduling is
not in this slice; adding it requires date-aware readers or an auditable scheduled transition runner.

## Review and commit contract

1. The client loads the institution-scoped current enrollment and ordered history.
2. The operator chooses a decision, supplies a reason and, for movement, destination class and roll.
3. The API checks `sis.manage`, current enrollment ID/revision, institution-local today, same-term target,
   roll availability and affected attendance finality.
4. Preview persists a 30-minute review containing the input and impact counts; it changes no roster.
5. Commit locks the review, school authority and student advisory boundary, then repeats every check.
6. A retry returns the saved result. A stale or expired review is rejected instead of guessed.

Impact preview reports submitted attendance registers, upcoming non-final assessments, active transport
assignments and open departure plans. It explains that connected records stay connected; it does not
claim those downstream records have changed state when they have not.

## Data and history semantics

- `enrollments.is_active` identifies current placement.
- `inactive_from` is an exclusive boundary: the previous placement is valid before this date; a moved
  placement begins on this date.
- `exit_kind`, `exit_reason`, `ended_by`, `ended_at` and `revision` retain decision evidence.
- Partial unique indexes allow historical same-term rows but enforce one active placement per student and
  term and one active roll per class and term.
- Pre-existing inactive rows are backfilled as `term_completed`; their actor remains unknown rather than
  inventing one.
- Hard deletion is not exposed.

## Bounded automatic propagation

After an authorized person confirms the decision, ThatCampus automatically performs only mechanical work:

- affected submitted registers from the effective date return to Draft; final registers block the command;
- destination subject-attendance aggregates are initialized without deleting source aggregates;
- one lifecycle audit and register-specific roster-change audits are written;
- a tenant-scoped `people.updated` event refreshes affected authorized consumers.

Automatic propagation does not terminate an account, guardian authority, transport assignment, money,
consent or safeguarding authority. Those records may be shown as connected impact but remain owned by
their domain workflows.

## Acceptance evidence required before release

- Repeat migration 100 and `people-lifecycle.integration.test.ts` in the release database pipeline; the
  loopback-only preview migration and all three isolated scenarios pass.
- Verify move, withdrawal, transfer-out, stale revision, retry idempotency, conflicting roll, tenant denial,
  locked register blocking, draft reopening, audit and outbox behavior.
- Verify principal UI at 320, 768, 1024 and 1440 pixel widths, keyboard-only navigation, focus visibility,
  screen-reader labels, errors and empty/no-current-enrollment state.
- Validate on a phone through the managed preview with real seeded students before deployment.
