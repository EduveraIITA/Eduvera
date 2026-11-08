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

It supports configurable term/class and explicit course-offering schemes,
continuous-assessment components,
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

## Course offerings and per-learner eligibility

A course report selects explicit offerings bound to the same term and compatible
programme context. Each selected offering needs a mapped published assessment plan
before activation. Credits and course code come from that offering's retained
academic binding. Two offerings of one subject remain distinct when their course
codes differ, including different credit weights. One report scheme currently
accepts one offering per course code; parallel sections sharing a code use separate
schemes rather than silently combining duplicate GPA attempts.

First course-report generation combines selected immutable publication audiences
with enrollment applicable on the current campus date, capped at term end. It
refuses a future term. Each learner includes their applicable courses: earlier
published marks remain evidence after an elective ends; an ended course without
marks is excluded. A currently enrolled late elective with no result in any mapped
publication remains an explicit incomplete course with null marks, not zero or an
omitted learner. Missing components block a complete release under the ordinary
review rules. Course eligibility is retained separately from scoring policy.

Generation freezes the canonical person audience, included/excluded offerings,
dated enrollment and publication provenance, academic context, configured policy
and calculated values. Corrections retain the first report's audience and included
course set while referring to newly reviewed published assessment sources. They do
not reinterpret an issued report from today's enrollment or credit changes. Legacy
class reports keep their existing immutable-publication roster behavior. Staff
remarks retain their class authority; a course report does not manufacture a class
assignment. Learners open only their own published person record. Workspace absence
of `academic_context=offering_v1` preserves class-only rows/counts and omits course
references for older clients.

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

## Institution result policies — owner extension, 26 October 2026

This extension adds independently versioned institution policies for **Percentage**,
**Grade** and **Grade points / GPA**. It supersedes the original percentage-only
calculation/display boundary for newly configured records, while preserving every
legacy scheme and issued snapshot with a null policy. Those records retain their
existing marks, percentages, grades and release lineage. No migration retrospectively
converts an issued result to a new scale.

An institution administrator creates a draft policy and explicitly activates it.
Activation freezes that version. Creating another policy with the same code creates
the next version; it never edits the earlier rules. A policy can be selected before
assessments are published because it is independent of the report scheme's published
assessment mappings. The policy, scheme, result and report interfaces remain within
the existing Assessments and Reports workspaces.

The policy records its output format, optional points scale, displayed decimal
precision, equal or credit-weighted percentage aggregation, absence treatment, fixed
exempt exclusion, failed-course GPA treatment and contiguous percentage-to-grade
bands. Each band records its code, label, pass decision and, for GPA, grade points.
Four-point, ten-point and explicit custom scales share the same evaluator. This is
an institution-owned mapping, not an inferred universal percentage/GPA conversion.

### Scoring and presentation

Assessments continue to retain real numeric marks and maximum marks as evidence.
Configured grade and point values are derived on the server from those marks;
typing a different optional grade cannot override the policy. Grade-only native
entry, relative/curved grading, imported external grade awards and automatic
promotion remain separate capabilities. The interface must make this marks-based
boundary clear and must not manufacture marks from a letter grade.

For band lookup, a normalized or weighted subject percentage is rounded half-up to
two decimals, then matched to the contiguous hundredth-based bands. The institution's
display precision controls the primary percentage or GPA value, not band boundaries.
Subject percentages round before overall aggregation. Percentage and grade policies
can use equal subject weighting or explicit course credits.

Screen and print format policy-controlled percentages, SGPA/CGPA and subject grade
points using the frozen result policy's decimal precision and the owning versioned
half-up rule. Formatting must not replace it with binary `toFixed` rounding at a
tie, consult today's policy or recalculate a saved grade/GPA. Keep real zero distinct
from a missing value. Credit quantities have their own precision: remove trailing
SQL storage padding only, preserving every recorded fractional credit rather than
rounding credits to result precision. Result values without a policy snapshot
retain their existing raw result presentation. The [display boundary review](../../artifacts/core-completeness-2/parity/report-precision-rounding-decision.json)
and [screen/print source evidence](../../artifacts/core-completeness-2/parity/report-precision-source.json)
keep presentation separate from canonical calculation and issued records.

GPA always uses credits:

`term GPA = sum(included course credits × mapped grade points) / sum(included credits)`.

Zero is a real score. Absence follows the frozen incomplete-or-zero policy. Withheld
and not-evaluated results never become zero. Exempt components are excluded and the
remaining component weights are renormalized; fully exempt subjects are excluded
from the overall denominator. All-exempt results have no GPA. A failed course either
retains its configured points and credits in GPA, or withholds the entire GPA under
the institution's explicit policy. Failed credits are never dropped to improve it.
Pass/fail comes from the frozen grade band for configured results; a percentage
threshold is not fabricated for a nonmonotonic band policy.

### Cumulative lineage and corrections

A GPA report scheme requires a cohort-specific `programme_key` (for example
`MTECH-DE-2026`) and positive `term_index`. Each included subject needs a stable
`course_code` and positive credits. A term's result is labelled SGPA / term GPA.
CGPA uses the same learner's latest published release of each earlier term in that
programme plus the current generated term. It does not average rounded term GPAs.

For a repeated course code, the latest term attempt replaces the earlier attempt,
including a later failed or incomplete attempt. Repeating a course twice within
one term is ambiguous and cannot produce CGPA. Every prior index from one to the
current term must be present. Competing published schemes for one prior term,
incompatible scales/bands/pass/absence/failure semantics or missing history leave
CGPA unavailable with a specific reason; they do not prevent an otherwise valid
term GPA from being issued. Policy names, version identities, grade descriptions
and display precision do not make identical calculation semantics incompatible.

Generation freezes the full policy identity and configuration, subject percentages,
grade points, credits, course codes, current and cumulative credit/point totals,
unavailable reasons and all selected source batch/student/subject IDs. Each attempt
states whether it contributes or was superseded. The batch fingerprint includes
current assessment publications and these per-learner cumulative inputs and totals.
An existing issued CGPA never changes when an earlier assessment or term is corrected.
A later generated release can include the corrected published sources with its own
correction reason. Publication refuses a prior-source change occurring after
generation, requiring regeneration through the normal review/publication journey.

### Authority, commands and storage

Only a current active institution administrator creates/activates policies and
coordinates configured schemes and report releases. Scoped staff still comment
through their existing authority, and learners/guardians receive only their own
published snapshots. The configured owner operations use the pre-write Model Core
command gateway and current human identity/authority checks; owning domain effects,
retained outcomes, report outbox IDs and audit history remain correlated. Exact
actor/world-qualified retries reuse their accepted result or retained refusal;
pending or mismatched requests cannot repeat effects. Missing coordination fails
closed. The 27 October academic repair extends that same gateway to bands-only
schemes, subject plans, activation, generation, review, publication, cancellation
and remarks; there is no alternate legacy writer. Legacy calculations and issued
records are not converted to configured policies.

Migrations 255 and 256 add versioned policy configuration, frozen policy and GPA
projections, and an explicit configured pass basis. Legacy pass constraints remain
in force for legacy rows. Configured rows must reference a parent release with a
frozen policy and match that policy's grade, points and pass decision. No browser
database grants are introduced. The same service, policy evaluator, SQL constraints
and selected-world store/clock apply in Live and Simulation; actual acceptance and
remaining deployment/device limits are recorded in the implementation checkpoint.

### 27 October — roster provenance and review finality

The first class/term report roster is the union of learners in its selected
immutable assessment publications, not today's active class. Corrected releases
retain the
previous batch's membership and recorded roll provenance. Missing components
remain incomplete; a later enrollment does not silently add a learner. Published
class/term context is separate from current placement. Unknown legacy provenance
stays unknown rather than receiving a guessed historical backfill.

Remarks lock the batch before its learner row, recheck current authority and draft
status, and increment both learner-comment and batch revisions. A reviewer must
therefore review the version containing the accepted remarks. Core retains only
an opaque native remarks receipt reference; private text remains in report-owned
records/audits. Accepted generation followed by failed readback offers refresh or
opening that exact release, never an automatic second generation.
