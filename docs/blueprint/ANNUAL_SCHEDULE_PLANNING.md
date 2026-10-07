# Annual schedule planning

Accepted 8 October 2026 following the user's approval of the researched workflow.
This extends blueprint sections 3, 6–8; it does not replace the shared navigation.

## Contract

- Academic terms and class structures belong to an academic year. Preparing a new
  year does not enroll learners, activate terms, or publish copied schedules.
- A recurring timetable is a dated, class/term-scoped draft. Published versions
  are immutable. Start dates and optional end dates are explicit; a bounded
  version expires back to the previously effective pattern.
- A later starting published version wins within its date range. Equal starting
  dates are rejected rather than resolved by creation order. One open draft per
  class/term keeps editing understandable. Simultaneous admin edits use revisions.
- Existing baselines are frozen before the first publication for that class/term.
  Past dates cannot be changed through the new publication flow.
- Effective schedule precedence: closure, published dated daily plan, applicable
  published recurring version, legacy baseline. Calendar events alone do not
  cancel lessons. Attendance and historical daily plans are never rewritten.
- Save is not publish. Publication rechecks tenant scope, active teachers, class,
  teacher and room overlaps on affected dates, then commits audit and outbox
  updates in the same transaction. A failed check leaves the draft unpublished.
- Reuse copies structure, not attendance, enrollments, holiday dates, or authority.
  Automatic generation is limited to predictable timings/copy operations; a full
  constraint solver is a later feature, not an implied capability.

## Experience

Schedule settings: academic year, school dates, class timetable. A class timetable
shows published arrangements and a single draft. Choose “From a date onward” or
“Date range”; one-date changes retain the existing Daily Plan workflow. Reuse
existing period sheets, theme, header and contextual Back navigation. Parents and
teachers retain the compact Day/Month/Year reader.

## Evidence sources

- Arbor new-year setup: https://support.arbor-education.com/hc/en-us/sections/9228082090909-New-School-Year-Setup-guide
- EduPage dated publication versus substitutions: https://help.edupage.org/?lang_id=1&p=u3/u343/u3040
- Lantiv required versus desirable constraints: https://timetabling-turbo.lantiv.com/wiki/Turbo8-Constraints.html
- CBSE foundational annual-planning guidance (2019, not a universal calendar): https://cbseacademic.nic.in/web_material/circulars/2019/15_circular_2019.pdf

## Release gates

Tenant isolation; stale revision and idempotent retry; draft invisibility; future
activation; bounded expiry; closure/day-plan precedence; historical preservation;
conflict rejection; new-year copy without enrollments; mobile and keyboard review.
Track actual results in IMPLEMENTATION_PLAN.md. Existing migration-ledger drift
must be reconciled before normal deployment; do not rewrite checksums silently.

## Delivered scope and deliberate limits

- Standalone Schedule settings replaces the routed live weekly editor. Prepare
  next year, closures, teaching-time targets and class timetables share one entry.
- An empty pattern can generate school-day timings and a break. Periods use the
  existing subject/teacher editor; a day can be copied to selected weekdays,
  including Sunday. Teaching allocation remains reviewable before publication.
- Calendar teaching-day indicators use the effective schedule. Assessment dates
  are read-only projections with family/staff scope checks, not duplicate events
  or automatic lesson cancellations.
- New publications start after today. Same-day exceptions use Daily Plan. A
  published start date cannot be overwritten; a new range cannot silently mask
  an already scheduled later start. End the range before that start or select a
  later start. This release does not provide cancellation of a published recurring
  version or a general-purpose constraint solver.
- Preparing a year leaves terms inactive. Enrollment/promotion and activation
  remain separate existing workflows, not implied by copying a class structure.
- Migration 054 was transactionally applied to local preview and isolated test
  databases. No remote migration, push or deployment was performed.
