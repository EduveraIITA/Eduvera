# Configurable grading and report cards

Status: implemented locally as `WF-LOCAL-021`, 5 October 2026.

This slice extends offline assessments into a policy-controlled term-report workflow.
It is deliberately institution-neutral: a school, college or coaching workspace can
name schemes, define grade bands, choose absence treatment, select assessment
components and weights, and set subject pass thresholds. No board, university or
coaching formula is embedded in application code.

## Product outcome and scope

The workflow answers five operational questions:

1. Which published assessments contribute to each subject and at what weight?
2. Which versioned grading policy produced a learner's result?
3. Has every learner's incomplete, absent, exempt or withheld outcome stayed explicit?
4. Did a second authorized person review the report release where policy requires it?
5. Which immutable release is currently visible to the learner and linked guardians?

It supports configurable term/class schemes, continuous-assessment components,
subject thresholds, grade bands, class-teacher and principal remarks, independent
review, publication and corrected releases. It does not implement online testing,
public rankings, transcripts, certificates, board-specific rules, promotion decisions
or institution-wide analytics.

## Roles and authority

- An institution administrator creates and activates schemes, generates immutable
  report snapshots, reviews and publishes releases, and records principal remarks.
- A staff member may add a class-teacher remark only while an effective-dated class
  assignment and the `reports.comment` permission are both active. This permission
  does not grant scheme, marks, review or publication authority.
- Independent review rejects the actor who generated the batch. Publication remains
  an administrator decision and requires a reviewed batch.
- Learners and linked guardians see only the latest published release for their own
  learner. Draft, reviewed and cancelled batches are private.

## State and correction model

Scheme: `draft -> active -> archived`.

- A draft can be configured. Every subject plan must contain one or more components
  whose weights total exactly 100%, and every mapped assessment must already have a
  published result for the same institution, term, cohort and subject.
- Activation freezes the policy. Later rules require a new version rather than
  silently changing the arithmetic behind an issued report.

Report batch: `draft -> reviewed -> published`, with cancellation before publication.

- Generation reads only the latest published assessment snapshot and stores the
  source publication/result identifiers, component calculations, subject results and
  learner totals in relational immutable snapshot rows.
- A later source correction creates a new sequenced report batch with a required
  correction reason. Earlier published releases remain auditable. Family views return
  the latest published sequence, clearly labelled when it is a correction.

## Calculation contract

- A scored result contributes its normalized percentage within its configured
  component. Multiple mapped assessments in a component are averaged, then multiplied
  by the component weight.
- `exempt`, `withheld` and `not_evaluated` never become zero. They make that subject
  incomplete. `absent` follows the scheme policy: either incomplete or a zero
  contribution. A real score of zero remains distinct from absence.
- Subject percentages are rounded to two decimals after weighted component
  calculation. Overall percentage is the mean of complete subject percentages. Grade
  bands must cover 0 through 100 without gaps or overlaps.
- No rank, percentile or peer comparison is calculated or exposed.

## Data, audit and security invariants

- Every scheme, mapping, batch, learner report and audit record is institution-scoped.
- Database constraints protect legal states, unique versions/sequences and bounded
  percentages. Service transactions recheck membership, relationships, revisions and
  source publication state at command time.
- Direct browser database roles receive no table grants. All eleven grading/report
  tables have RLS enabled as defence in depth and remain behind the authenticated API.
- Review, publication, remarks and correction events retain actor, time, note and
  snapshot lineage. Published source rows are never overwritten.

## Interface and API

The responsive principal workspace is `/principal/report-cards`; the scoped teacher
workspace is `/teacher/report-cards`. Learner and guardian term reports appear above
individual assessment results on `/student/results` and `/parent/results`, with a
print-safe report-card layout. The application API is rooted at
`/api/v1/schools/:schoolId/academic-reports`.

The interface uses the existing portal shell, page title, navigation, typography and
16 px mobile gutter. It exposes operational state and required actions without
promotional or implementation copy.

## Acceptance and remaining gates

Automated acceptance covers calculation, independent-review denial, family isolation,
immutable publication, correction sequencing, demo seeding and responsive UI states.
An institution must still approve its grade bands, assessment weights, absence policy,
remark wording, correction SOP and printed form before live use. Board/university
policy packs, promotion decisions, transcripts, certificates, longitudinal analytics,
digital signatures and record-retention policy remain later slices.
