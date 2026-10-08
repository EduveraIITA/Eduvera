# Student Pulse — 8 October 2026

User-approved scope: named attendance review prompts, evidence screens, supportive
private check-ins and principal oversight. Preserve the existing blue/mint theme,
Plus Jakarta Sans, OperationsShell, mobile navigation and adult-operated workflow.

## Implemented slice

Principal: Insights → Student Pulse (also in More). Teacher: More → Student Pulse,
subject to `followups.manage` and the same-class permission check. Both use
`/{portal}/student-pulse` and `/{portal}/student-pulse/:studentId/:termId/:subjectId`.

The overview has Needs attention, Follow-ups and Class patterns. Individual views
have Attendance evidence, Plan a check-in and Progress. Cards name the student and
subject, show the actual numerator/denominator and weighted other-subject rate,
and suggest a supportive conversation without inferring motives. Class patterns
require three individual flags in the same class, subject and term.

The NestJS StudentPulseModule provides tenant/class-scoped GET list/detail and PUT
follow-up commands. Migration 055 stores named owners, dates, structured actions,
review state, closure outcome, immutable baseline and append-only revision history.
Writes require a human records-review confirmation and an eligible owner; stale
revisions return 409. Advisory transaction locks prevent duplicate concurrent case
creation. Ordinary responses and cached UI data are tenant/user scoped. No family,
student or owner message is automatically sent. No clinical or safeguarding free-text
narratives are stored here. Existing restricted-care workflows remain separate.

## Source and inference limits

Current `subject_attendance` contains cumulative term totals, not dated lesson
observations. The provisional rule compares valid same-student/same-term records:
minimum five eligible subject sessions, ten other sessions, three not recorded as
attended, and a gap of at least 20 percentage points. Excused sessions are excluded.
Invalid and missing totals do not become absences. These are review heuristics,
not validated behavioural predictions. Teachers must verify original registers,
leave, cancellations and recording completeness before taking action.

No consecutive-miss, preceding/following-period, sudden-decline, last-nine-lessons,
or after-lunch claims are generated. Source completeness and source update time
cannot be established from this table. Snapshot retrieval time is labelled as such.
Only currently enrolled learners in currently dated terms are considered. Migration
and API do not turn daily attendance into period attendance, and do not implement
attendance carry-forward. Dated period capture and its ingestion must be a separate
increment before those richer pattern claims are enabled.

Progress compares cumulative totals with the immutable case-opening baseline and
handles inconsistent corrections explicitly. It does not attribute improvement to
the intervention. Human closure does not establish improved attendance. Existing
reviews remain in Follow-ups when the current gap falls below the rule threshold.
There is no automated diagnosis, punishment, parent escalation or case closure.

## Verification and release gates

Local: frontend production build, backend production build, eight rule tests and
eight screen interaction tests passed. Focused frontend changed-file lint passed.
The database integration suite covers scoped reads, invalid owners, required review,
revision conflicts, append-only history, baseline immutability and explicit closure.
Run it only against an isolated disposable PostgreSQL database after migration 055.
The feature CI workflow runs migrations and these tests; its result is the release
record. Full regression and browser/device review must be reported separately.

Stage merge, deployment, physical-phone review, school operating validation and
source-record completeness validation are not claimed by this implementation record.
