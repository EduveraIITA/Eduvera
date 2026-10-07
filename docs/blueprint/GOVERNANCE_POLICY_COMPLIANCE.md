# Institution governance and policy centre

Status: implementation started, 4 October 2026. This document is a delivery contract,
not a legal-compliance certificate. Institution leaders remain responsible for confirming
which rules apply with their board, university, regulator, state authority and advisers.

## Product decision

OmniSchool is intended to support schools, colleges and coaching institutions. The existing
`schools` table remains the tenancy anchor so that current enrolment, attendance and timetable
workflows are not destabilised. New governance capabilities use institution-neutral names and
an explicit institution regulatory profile. Product capability packs determine which workflows
and policy families are applicable.

The first enabled pack is `india_school_core`. Future packs may add Indian higher-education,
university-affiliated college, skill/vocational and coaching-centre requirements. A future pack
must add its own applicability evidence and acceptance tests; it must not silently reuse school
rules.

Governance authority is now a separate first-class layer. The detailed, superseding architecture is
[Institute governance, authority and mobile operations](INSTITUTE_GOVERNANCE_AUTHORITY_ARCHITECTURE.md).
Policy drafting access does not authorise policy adoption. Office, body, seat, appointment, mandate and
decision-matter records establish the source-backed route; technical access remains governed by
[Work profiles, assignments and calculated access](WORK_PROFILE_ACCESS_ARCHITECTURE.md).

## Slice plan and progress

| Slice | Outcome | State | Verification evidence |
| --- | --- | --- | --- |
| G1 | Institution profile, applicability preview and seeded policy register | Implemented locally; UI sign-off pending | Migration 034; backend governance integration tests; live demo API returns 13 applicable families |
| G2 | Versioned draft, review, publication, retirement and audience access | Implemented locally; UI sign-off pending | Backend lifecycle/immutability/authorization/outbox tests; frontend policy-centre tests |
| G3 | Member policy library and acknowledgements | Implemented locally; UI sign-off pending | Version-specific idempotency test and role-aware frontend library test |
| G4 | Restricted child-protection concern intake, statutory-report record and assigned case access | Implemented locally; UI and operational sign-off pending | Migrations 035-036; 5/5 backend workflow tests; 3/3 frontend workflow tests; encryption and metadata-only event assertions |
| G5 | Admission, withdrawal and transfer-certificate workflow | Planned | Requires state/board configuration |
| G6 | Attendance-register certification and statutory exports | Planned | Requires register retention decisions |
| G7 | Privacy rights, guardian authority and retention workflow | Planned | DPDP operational pack must be date-gated |
| G8 | Inclusion, health, emergency and reasonable-accommodation workflow | Planned | Restricted-data boundary required |
| G9 | Staff service records, POSH committee/training and statutory reminders | Planned | Employment-law/state applicability review required |
| G10 | Public disclosures, evidence register and inspection export | Planned | Regulator-specific templates required |
| A1 | Authority sources, offices, bodies, seats, appointments, mandates and decision map | Implemented locally; UI sign-off pending | Migration 048; guided setup API/UI; Cambridge verified fixture |
| A2 | Protected adoption, appointment evidence, vacancy/expiry continuity | Planned | Must use current authority; no self-adoption |
| A3 | Complete collective decision procedure and resolution | Planned | Eligibility, conflicts, quorum, threshold and certification required |

## G1-G4 scope

### Institution regulatory profile

- Institution kind: school, college, coaching institution or hybrid.
- Country, State/UT and district.
- Management type, delivery mode and education levels.
- Board, regulator or affiliating-university codes as an explicit list.
- Residential, transport and minors-enrolled flags.
- Staff-count band and enabled capability packs.
- Optimistic revision, actor history and institution-scoped audit.

An empty or incomplete profile is shown as **review required**. The application never infers
recognition, affiliation or legal compliance from timetable/enrolment data.

### Policy lifecycle

`draft -> in_review -> published -> retired`, with rejection returning the version to draft.
Each revision preserves summary, full school-authored text, audiences, acknowledgement rule,
effective date, review date, source note, author/reviewer and an immutable version number.
Publishing retires the preceding published version prospectively; prior acknowledgements stay
bound to the exact version that was read.

High-risk policy families require a second active administrator when the institution has two or
more. A one-administrator institution may use an explicit documented override; the UI and audit
must label that separation was not achieved. This keeps a small institution usable without
pretending that independent review occurred.

### Access and disclosure

- Administrators can maintain the profile and policy lifecycle.
- Active members can read only published versions whose audience includes their membership role.
- Acknowledgement records mean “this version was presented and acknowledged”; they do not mean
  informed consent, waiver, legal acceptance or approval of a child-safety decision.
- Events and notifications carry IDs and revision metadata, not policy bodies.

### Restricted care workflow (G4)

The restricted-care workspace is a separate operational boundary from policy documents and
message moderation. Active staff can record a factual concern only to a currently configured
primary or alternate route. If an ordinary handler may be involved, the alternate route is
mandatory. Institution administrators configure dated, purpose-specific care-team assignments,
but administrator title alone does not grant access to a case.

Each case grants the reporter an intake-only receipt and explicitly assigns full handling access
to the selected care owner. Notes, statutory-report rationale and external authority references
are AES-256-GCM encrypted at the application boundary with case- and entry-bound additional data.
Outbox, notifications and ordinary audit metadata contain neutral identifiers and revisions, not
the protected narrative. The server prevents closure while reporting is still being assessed or
a recorded decision says reporting is required but no external-report evidence exists.

This workflow is enabled by the minor-safeguarding capability, not by the tenant table name.
School, college, coaching and hybrid institutions with enrolled minors can use the same restricted
boundary; adult-only institutions need a separately reviewed conduct/welfare pack rather than
silently inheriting child-protection language. Detailed contract: [Restricted care workflow](RESTRICTED_CARE_WORKFLOW.md).

## India school core pack

The initial catalogue covers child protection, anti-bullying/cyber safety, grievance redressal,
admission/withdrawal/transfer, attendance, privacy and data rights, guardian authority, staff
conduct/POSH, inclusion/accommodation, health/emergency, communications/acceptable use,
events/trips/transport, and fees/refunds. Source links are prompts for school review, not claims
that a template alone meets every state, board or institution obligation.

Key applicability inputs and official-source families include the Right of Children to Free and
Compulsory Education Act and Rules, POCSO Act, Rights of Persons with Disabilities Act, POSH Act,
Digital Personal Data Protection Act/Rules commencement dates, Ministry of Education school-safety
guidance, NCPCR guidance and conditional CBSE affiliation requirements.

## Invariants

- GOV-001: every record is institution-scoped; cross-tenant family/version/acknowledgement links
  are rejected by PostgreSQL.
- GOV-002: every command rechecks active membership and appropriate administrator authority.
- GOV-003: a published version cannot be edited in place; a new numbered draft is required.
- GOV-004: no more than one published version exists per policy family.
- GOV-005: the reviewer works from the exact expected revision; stale decisions conflict.
- GOV-006: member access is based on current membership and the published version's audience.
- GOV-007: acknowledgement is version-specific and idempotent.
- GOV-008: profile, lifecycle and acknowledgement transitions write auditable actor/time evidence;
  publication and acknowledgement also write transactional outbox events.
- GOV-009: policy content and acknowledgements are not child-protection case records, medical
  records, collection authority, consent, fee settlement or attendance corrections.
- GOV-010: capability packs are additive configuration. Enabling a new institution type does not
  erase stricter minor-safety rules while minors remain enrolled.
- CARE-001: active staff membership permits intake, not broad case discovery; reads require an
  active case assignment and inaccessible cases return not found.
- CARE-002: administrator status permits route configuration but does not grant case-content access.
- CARE-003: an involved ordinary route cannot receive the intake; the configured alternate route
  is required and rechecked in the transaction.
- CARE-004: protected narrative and authority references are encrypted; event and notification
  envelopes contain identifiers and revisions only.
- CARE-005: the product records a human reporting assessment and evidence. It does not decide the
  legal duty, notify guardians automatically, investigate, diagnose or replace emergency contact.
- CARE-006: a case cannot close with an unresolved reporting assessment or an outstanding required
  external report.

## G1-G3 acceptance contract

1. An administrator can complete and revise the institution profile; stale revisions fail.
2. A seeded applicable policy family can be drafted without changing its published version.
3. Submit freezes the draft for review; edit attempts are rejected until rejection or publication.
4. Review records the reviewer, note and separation status; publication retires the old version.
5. A non-administrator cannot change profile or lifecycle state.
6. An active member sees only published policies for their role; draft text is not returned.
7. A member can acknowledge once; retries return the existing acknowledgement.
8. Acknowledging a newer version does not rewrite acknowledgement of an older version.
9. Audit/outbox rows are written in the same transaction as authoritative state changes.
10. All new public-schema tables have RLS enabled and no PUBLIC/anon/authenticated grants.

## Explicit boundaries for G1-G4

- No claim of legal certification, automatic filing, regulator submission or universal India rule.
- No automatic guardian disclosure, regulator/police submission, investigation, evidence upload,
  legal conclusion, risk diagnosis or AI processing of restricted-care content.
- No uploaded documents or object storage in G1-G3.
- No automated legal-text generation or autonomous applicability decision.
- No college/coaching policy pack is enabled until its source and workflow review is complete.

## Verification record — 4 October 2026

- Migration 034 applied to local development and disposable test databases. All five new tables
  have RLS enabled, share the established runtime owner and expose no PUBLIC/anon/authenticated
  table grants.
- `backend/test/governance.integration.test.ts`: 5/5 passed against disposable PostgreSQL,
  covering profile concurrency, authorization, lifecycle, high-risk review override,
  immutability, audience access, idempotent acknowledgement, audit and outbox privacy.
- `frontend/src/features/governance/governance.test.tsx`: 3/3 passed, covering the principal
  register/editor, institution profile separation and member acknowledgement language.
- Migrations 035-036 applied to local development and disposable test databases. Restricted-care
  tables have RLS enabled, no browser-role grants and the direct application owner. Migration 036
  also repairs the durable event tables when an older database was migrated by a separate owner.
- `backend/test/restricted-care.integration.test.ts`: 5/5 passed, covering dated primary/alternate
  roles, encrypted intake, reporter/owner access separation, statutory-report evidence and closure
  gating, involved-handler alternate routing, administrator non-bypass, audit and outbox privacy.
- `frontend/src/features/restricted-care/restricted-care.test.tsx`: 3/3 passed, covering emergency
  guidance, assignment-limited queues, forced alternate routing and care-team/case separation.
- Backend and frontend type-check and lint passed. Backend production compile passed. Frontend
  Vite production build passed to an isolated output directory; the repository's old `dist`
  directory was an iCloud-blocked generated artifact and was not used as release evidence.
- Local backend `/readyz` and Vite route `/principal/governance` returned HTTP 200. An authenticated
  demo-admin API read returned institution kind `school`, 13 applicable policies and 13 families.
- The complete frontend regression suite passed: 35 test files and 222 tests. The production
  frontend bundle also built successfully to an isolated output directory.
- A responsive in-app browser inspection confirmed the principal restricted-care overview and
  protected-intake sheet render without visible overlap at the mobile review viewport. User UI
  sign-off remains open. The local preview is available at
  `http://127.0.0.1:5173/principal/safeguarding`.
