# Attendance workspace delivery — 20 September 2026

This is a B3 attendance-flow correction against School_Operations_Blueprint.pdf (role-scoped workspaces, accepted attendance decisions, principal oversight and auditable correction). It does not mark the broader blueprint complete.

## Delivered

- Teacher Attendance opens an explicit, searchable class workspace instead of redirecting into the first class. Date and class remain in the URL; returning from a register preserves its date.
- The workspace uses the same current authorization rule as register access: the selected term's weekly teaching assignments, plus accepted substitute coverage on the selected date. A regular class remains visible on a day without a lesson. No new permissions or fabricated class-teacher ownership were introduced.
- School-scoped batch queries provide enrollment counts, actual register state, assigned teaching teams and submitting user. Principal timetable counts now use the effective dated schedule rather than only the baseline weekly slots.
- Principal queues distinguish registers awaiting submission, submitted records awaiting review, and locked records. Teaching teams are expandable to keep mobile cards readable.
- Principal registers start read-only. Completing a draft or correcting a submission is explicit. Existing correction reasons, revision/idempotency checks, change history, principal-only locking and reasoned reopening remain enforced.
- The UI shares the backend's date policy: future/non-instructional dates are read-only, and these classes are not counted as overdue submissions. Empty classes also have no register due. Missing marks are never counted as absences.
- Bulk present marking fills only unmarked students, preserving existing absent/late/excused/half-day decisions. Older cached register revisions cannot replace a newer save/unlock result.
- Preserved the shared school header, role navigation, Plus Jakarta Sans, blue/mint palette, rounded cards and responsive register controls. Taste frontend engineering and Postgres batch-query guidance informed the implementation.

## Verification

- Frontend production build and changed-file ESLint checks passed.
- All 127 frontend tests passed; includes 16 attendance workspace/register tests covering class links, queue filters, empty/holiday/future states, principal review, corrections, conflict handling, photo drafts and reopening.
- All 58 API/day-plan integration tests passed against loopback `omnischool_node_test`, including assignment visibility off teaching days, unauthorized direct access, future submission rejection, actor attribution, submission replay, lock/reopen and weighted principal totals. The existing missing `017_photo_attendance.sql` migration was applied to this isolated test database only.
- Live browser verification at 390px: teacher class selection/register; principal queue/review; disabled controls before explicit editing. No demo attendance records were submitted during visual QA.
- Local API `/readyz`: database and event broker ready. Existing ngrok domain returns HTTP 200 for both `/login` and `/api/v1/auth/csrf/`.

## Review boundary

Please validate the teacher class-selection flow and principal review hierarchy before further large UI changes. This work preserves the current weekly-subject-teacher authorization policy; a separate date-bounded class-teacher ownership/delegation model remains a broader blueprint decision, not an implicit permission change in this UI fix.
