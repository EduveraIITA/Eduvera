# Restricted care workflow

Status: original local workflow from 4 October 2026; exact intake/continuity repairs verified
against disposable PostgreSQL and component tests on 27 October. Combined-release authenticated
UI and institution-operating review remain separate gates. This is an operational record, not
legal advice or a compliance certificate.

## Purpose and applicability

This workflow gives an institution a deliberately narrow place to receive and handle a concern
about a child or minor. It is capability-based so the same boundary can be enabled for a school,
college, coaching institution or hybrid whenever minors are enrolled. It is not automatically
enabled as an adult learner conduct, counselling or grievance system.

The implementation follows the blueprint's restricted-care boundary: assigned referrals,
explicit ownership, an urgent external-contact path, recorded actions and outcomes, and no broad
feed of allegations. Product wording also reflects the POCSO reporting duties and penalties for
failure to report, NCPCR guidance on designated and alternate reporting routes, Ministry of
Education school-safety guidance and India's ERSS 112 emergency route. Institution leaders must
validate local/state/board procedures and name the responsible people before operational use.

## Roles and access

- Any active staff member may record a concern, but staff can select only a currently assigned
  student. An unknown/unlisted child can be recorded without selecting a student; identifying
  details then remain inside the encrypted note.
- Administrators configure dated `primary` and `alternate` care-team assignments for an active
  staff member. Role labels are designated lead, deputy lead, institution head, counsellor and
  external liaison. These labels route intake; they do not confer unrestricted case access.
- Opening a case creates an intake-only reporter assignment and a full owner assignment. Only
  explicit active assignments can read case content. A principal or administrator cannot browse
  an unassigned case merely because of job title.
- When the ordinary handler may be involved, the request must use the separately configured
  alternate route. The reporter cannot be selected as alternate owner for that intake.

## State and commands

Case state is `open -> triage -> active -> closed`. Reporting state begins as
`assessment_required`, then records either `reporting_required` or `not_applicable`. Recording an
external authority report changes it to `reported`. Supported protected entries are safety action,
contact, case note, outcome and handover; handlers can also reassign the owner with a reason.

Every command checks the expected revision. Closure fails if the reporting assessment is still
open or a required external report has not been recorded. The software never calculates whether
a report is legally required: an authorised human records that assessment and the external report
evidence. In immediate danger, the UI directs the user to call 112 and follow the institution's
approved police, SJPU, Child Helpline or emergency procedure without waiting for the application.

## Data boundary

- Intake and handling notes, reporting rationale and external references use AES-256-GCM
  encryption with a deployment secret distinct from the cookie secret. Additional authenticated
  data binds ciphertext to its institution, case, entry and entry type.
- The deployment refuses to start in stage/production without a separate restricted-case key.
- Audits retain actor, time, action, IDs and revision metadata. Transactional outbox and ordinary
  notifications contain only neutral identifiers and a generic prompt to open the restricted
  workspace. They do not copy protected narrative or authority references.
- All six restricted-care tables are institution-scoped, have PostgreSQL RLS enabled, expose no
  PUBLIC/anon/authenticated grants and share the direct application owner. Cross-institution
  relationship triggers reject invalid links.
- Case closure preserves evidence. There is intentionally no delete command in this slice.

## Acceptance evidence

### Exact intake and continuity — 27 October

- Each new concern has one stable intent ID. A committed save with a lost response is
  reconciled by its exact actor/world-bound receipt; retrying the unchanged intent does not
  open another case. A genuinely separate concern is never merged merely because names or
  narrative match. Previously uncertain saves remain retained after later access errors.
- Intake and case actions traverse the existing Model Core command/receipt and event-journal
  ports before native acceptance. Core holds only a secret-key payload commitment, opaque
  case/native receipt IDs and revisions. Notes and external references remain encrypted in
  their owning care tables, never ordinary events, notifications or Core outcomes.
- Reads, commands, receipt confirmation and route eligibility require a current canonical
  acting account endpoint plus active staff membership in the selected institution/world.
  Closing app access cannot leave an inaccessible owner falsely shown as operational.
- The exact current owner can explicitly hand confidential responsibility to a currently
  eligible lead on the same protected route. The ordinary-handler-involved route cannot hand
  the case back to its reporter. Prior full access ends; an original reporter retains only
  their own intake receipt. Changing an intake-team assignment alone does not revoke an
  independently retained case assignment.
- A separate administrator recovery view exposes only opaque case reference, current owner,
  protected route and revision, in ten-record pages. It appears only for an open case whose
  exact owner assignment, staff membership, account or canonical endpoint is no longer
  active. A revision-checked explicit assignment restores responsibility to an eligible
  same-route lead; administration does not itself grant access to allegations or later notes.
  Original reporter/assignment identities remain immutable even when a departed subject is
  revoked. Protected recovery reasons are encrypted, not copied into revocation metadata.
- New ownership appears in the same native assigned-case queue and neutral attention update;
  this repair does not claim a new configured mailbox/reaction handover protocol or automatic
  safeguarding decision. The complete typed-mailbox protocol remains a separate coordination
  boundary. Revoked or inactive recipients are excluded from new update audiences.
- External reporting offers editable **Reported at**, defaulted to the selected-world current
  instant and rejecting a future instant. Actual report time remains distinct from the
  server-owned recording time displayed in the record.
- The recovery cache contains only opaque references. Exact callable drafts remain active
  session memory only, are removed after terminal confirmation and dropped across actor/world
  scope changes. They are not persisted to browser storage as unencrypted protected drafts.
  A full browser restart can therefore require checking the exact retained native receipt;
  no offline protected-narrative storage or automatic replay is claimed.
- Simulation deliberately omits captured original note/report bodies. The common UI labels
  that omission instead of presenting an empty history as no evidence. New run-local intake,
  reporting and handover still use the same owning encrypted records and command path.

Source-level regression evidence: `backend/test/restricted-care-continuity.integration.test.ts`
(six native checks and one real COW check, including unchanged Live/sibling state);
`frontend/src/features/restricted-care/restricted-care.test.tsx` and
`CarePendingReceipts.test.tsx` (18 component checks). The original five HTTP checks are
migrated to canonical identity fixtures and stable command IDs; their compiled-server gate
is owned by the combined release. Institution legal/operating validation remains required.

### Original workflow coverage

1. Primary and alternate dated roles can be configured only by an active administrator.
2. A staff reporter can create encrypted intake; the reporter sees only that intake receipt while
   the assigned owner sees the full protected record.
3. Unassigned users, including administrators, cannot discover or read a case.
4. An involved ordinary handler forces the alternate route.
5. Required reporting blocks closure until external authority evidence is recorded.
6. Protected text is absent from outbox and ordinary audit metadata.
7. Emergency guidance, case queue, intake, full-handler actions and care-team settings render in
   the existing responsive teacher/principal shell.

Automated evidence: `backend/test/restricted-care.integration.test.ts` (5 passing cases),
`frontend/src/features/restricted-care/restricted-care.test.tsx` (3 passing cases), backend and
frontend type-check/lint, and backend production compilation.

## Explicitly not implemented

- Automated police/SJPU/CWC/helpline filing, email/SMS/WhatsApp delivery or proof of receipt.
- Guardian notification; disclosure can itself create risk and requires authorised human judgment.
- Interviews, investigation plans, medical/psychological diagnosis, credibility scoring or risk AI.
- Evidence/document upload, retention disposition, legal hold, redaction/export or subject-access
  handling. These require the privacy and object-storage gates before production use.
- Adult learner welfare, POSH or grievance case management. Those require separate applicability,
  confidentiality and escalation contracts even if they later reuse the restricted-data platform.

## Required operational review before release

The institution must validate its named primary and alternate recipients, after-hours fallback,
local authority contact procedure, guardian-disclosure decision path, staff training, device/privacy
conditions, retention schedule and a tabletop drill. Authenticated UI review on both mobile and
desktop remains open; synthetic tests do not approve the workflow for a live child-safety case.
