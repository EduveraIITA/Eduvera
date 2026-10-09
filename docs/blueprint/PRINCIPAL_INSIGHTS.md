# Principal insights

The principal home Overview has a compact, read-only blue daily snapshot: students
marked and registers submitted. Its date control and Timetable link sit outside the
card. Below it, Needs attention links to the work, School pulse summarizes current
term attendance/results and current coverage/fees, and Coming up shows dated events.
At most four attention rows appear initially; further checks use one disclosure.
The full register directory, review lists and conversations are separate pages.

The dedicated destination merges Analytics and Insights at `/<portal>/insights`.
Its principal landing page leads with a compact attention brief, followed by the
current institution snapshot, recorded trends/results and school operations.
Teachers and families retain only their existing authorized analytics. Legacy `/analytics/*`
bookmarks redirect with class, learner and period context intact.
Principal mobile navigation is Overview / Attendance / Insights / More; Timetable
remains in More and the desktop sidebar. Teacher navigation is unchanged.

Overview always uses a whole-school 28-day review window and 50% academic threshold,
ignoring full-dashboard query filters to avoid a silently narrowed daily summary.
Overview's School pulse uses whole-school current-term analytics, with the reporting
end date visible. Selecting an older daily snapshot does not turn current fees or
forward teacher assignments into historical values. The blue card itself is never
actionable. Full source data remains behind links to existing authorized workflows.
`/principal/attendance/thresholds` contains the dated minimum-attendance list and
`/principal/followups` contains the existing conversation workspace; both return to
the dated Overview. Legacy home conversation anchors redirect to the latter page.
The dedicated Insights experience also uses separate topic pages.
The deadline brief opens Coverage & deadlines. Back navigation retains filters and
returns related reviews to their parent topic.

## Focused attendance review

`/principal/insights/review` is a review queue, not an aggregate scorecard. It starts
with students who meet the decline criteria and have no open follow-up. Each row
shows the student, class, current percentage and change from the previous window.
Already-owned work is available through All when relevant. The class selector stays
visible; the Review period icon reveals date/window controls. Review rules are
secondary disclosure content, not introductory instructions.

Opening a student navigates to `/principal/insights/review/:studentId`: two comparable
attendance periods, relevant missing-homework evidence, and a next step. Existing
follow-ups reuse the authorized coordination inbox. Otherwise the action opens the
class register to review the evidence with the teacher. Creating a follow-up still
requires an existing eligible attendance record in the established workflow; this
page never creates a case or contacts a family automatically. Unknown students or
students outside the returned authorized review list do not receive invented detail.

Recording completeness lives separately at `/principal/insights/recording`, so a
missing record is not presented as an attendance decline. Capped student lists show
the shown/total difference and suggest narrowing by class. No decline meeting the
rules is not an institution-wide all-clear.

## Reporting scope

Recorded trend graphs retain their term / 30-day / 90-day range. Attendance and
learning reviews retain the original 14 / 28 / 56-day comparison window and learning
threshold. Those controls belong to their topic pages, not the Insights overview.
Current follow-ups, fee balances and next-seven-day coverage remain explicitly
dated operational views. These different denominators and date definitions are not
silently combined into a new metric. In particular, learning review uses publication
dates while the published-results average uses assessment dates.

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
recoverable errors have explicit states. The two read models fail independently:
available trend graphs remain usable if operational highlights cannot load, and
vice versa. Charts have text/table alternatives and missing observations remain
gaps rather than zero. Home attention rows include register submission, assignment
mismatches, attendance follow-ups/declines, term thresholds, unassigned periods,
deadline clashes and submitted/moderated assessments when present. These counts
are not added into an invented unique-student total. The home threshold list is
capped at 20 and labelled when reached; the Insights review list is capped at 50
with shown/total context. Aggregate Insights totals remain uncapped.

The School pulse result average is the existing mean of scored results from latest
published assessment snapshots in the current term, not an official report-card
grade or a pass rate. Teaching coverage means assigned effective periods, not
delivered lessons. Fees due today contribute to outstanding balances but not the
overdue label. A missing denominator shows Not recorded / No scores / No periods;
it is never an invented zero or 100%. Failed academic and operational requests
remain independent and recoverable. These home summaries reuse existing query keys,
active-school authorization, school-event invalidation and minute refreshes.

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
