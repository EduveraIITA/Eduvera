# Principal insights

The principal Overview keeps four summary cards and a compact action brief beside
daily operations. Its dated **View all insights** link opens `/principal/insights`.
The dedicated page groups graphs into Attendance & learning, Operations and Finance,
with an ending-date picker plus review-window, class and threshold filters.
Principal mobile navigation is Overview / Attendance / Insights / More; Timetable
remains in More and the desktop sidebar. Teacher navigation is unchanged.

Overview always uses a whole-school 28-day review window and 50% academic threshold,
ignoring full-dashboard query filters to avoid a silently narrowed daily summary.
Both views retain source-record dialogs; the deadline brief opens the full page at
the deadline section. Filters survive in-page deadline links and ending-date changes.

`GET /api/v1/schools/:schoolId/principal-insights/` requires an active administrator
membership and account; an active school context cannot access another school.
Class filters are checked against the same school. Responses are private/no-store.
Queries run in one repeatable-read transaction; restricted safeguarding records are
not read. No schema change is required.

## Metric definitions

| Insight | Definition and interpretation |
| --- | --- |
| Review window | 14, 28 or 56 calendar days, ending at the requested date capped at today in the school timezone. Prior window has the same length. |
| Attendance | Current enrolled cohort and effective scheduled school days. Present/late = 1, half-day = 0.5, absent = 0; excused is excluded from the scored denominator. Missing registers are not absences. |
| Completeness | Recorded student-days / expected student-days. Weekly chart values use summed points / summed scored days, not averaged class percentages. |
| Engagement change | Attendance falls at least 10 percentage points versus the prior window, with at least five scored days and 80% recording completeness in each window. Distinct students are counted once. |
| Homework combination | A flagged student also has at least two due, published homework items without a completion record. Missing completion records do not prove non-submission. |
| No open follow-up | Flagged students without a current open follow-up. It suggests review, not an automatic instruction to contact families. |
| Learning review | Latest published result snapshot per assessment, published within the review window. Counts scored results below a configurable percentage of marks. Unpublished marks and missing scores are excluded. This is not topic mastery or a pass/fail rule. |
| Follow-through | Current awaiting/review statuses, overdue open follow-ups, and resolutions within the review window. Counts are records, not unique students or a conversion funnel. |
| Teaching coverage | Effective periods over the next seven days from today. Missing teachers or unaccepted coverage count as unassigned. Cancelled periods are shown separately. Assignment does not establish delivery. |
| Deadline pressure | Class-days with at least three published homework or scheduled assessment deadlines over the next seven days. No estimate of effort or difficulty. |
| Fee ageing | Invoices due as of today, net of credits, allocated payments and refunds. Future instalments are excluded; no student balances are returned. |

## Interaction and boundaries

Filters persist in the URL and retain the existing page date. The dashboard refreshes
on school events and every minute. Loading, incomplete data, empty results and
recoverable errors have explicit states. Charts have text/table alternatives; detail
dialogs support keyboard dismissal and restore focus. Student details are capped
at 50 with that limit disclosed. Aggregate totals remain uncapped.

Historical attendance uses current enrolments and the effective calendar, rather
than a frozen historical cohort. Follow-up state, fee balances and forward schedule
are operational views as of today, even when the selected attendance date is older.
Topic mastery, verified instructional time, intervention impact, transport causes
and reopened complaints need additional evidence and are not inferred.

Backend integration fixtures exercise attendance denominators, missing and excused
records, half-days, latest assessment publications, fees, owner/deadline joins and
cross-school/role denial. Frontend tests cover filters, accessible details, empty
results, retry states and event invalidation. Responsive browser validation uses
synthetic fixtures; actual institution-data verification remains a Stage gate.

The initial navigation PR check passed all 326 PostgreSQL-backed backend tests
and 444/445 frontend tests. Its sole failure was the existing four-child parent
card-cycle test: whole-page role polling during transitions could delay the
switch timer. The test now waits on the captured enabled chooser and checks the
active card's exact accessible identity after each swipe. All eight directions/
wraparound steps and timeout limits are preserved; parent runtime code is unchanged.
The complete CI suite must pass again before merge.
