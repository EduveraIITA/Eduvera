# Unified people groups and connections

Owner direction: 20 October 2026. One understandable People experience must serve
the evolving campus, rather than separate student, guardian and employee
directories. This contract extends the existing People, Universal Institution,
Model Core, enrollment, employment and organization owners; it does not replace
their invariants with freely editable tags or a generic business graph.

## Product model

**Add a person once. Connect them to people, groups and work as needed.**

People and Groups are the primary views. Opening People goes straight to its
searchable, paginated directory. A person opens one canonical profile. Details
and actions appear only when relevant and currently authorized. Import is a
secondary, purpose-specific action; the existing enrollment import is not called
a universal people importer unless its supported semantics actually broaden.

Name is sufficient to add a passive person. Creating or correcting that person
does not require an app account, academic year, class, guardian or employment.
Affiliations can coexist. An employee who is a guardian and attends training is
one person, not three profiles with separate attendance identities.

The profile can show groups, supported person connections and contextual
Learning/Work/family summaries, opening focused owning actions. Enrollment,
guardian linkage, employment and app access attach explicitly to this person.
Existing-person selection uses canonical IDs and current revisions; a matching
name, phone or email never silently merges identities. Import review must make
existing-person attachment explicit and preserve its receipt/history.

Owner clarification, 21 October: creation and name correction use one Name field.
Do not infer family-name boundaries or alter internal spacing, spelling or script.
The current API's legacy `first_name` / `last_name` keys can carry the complete
name in the former and an empty latter; this is compatibility storage, not a new
claim about a person's given or family name. Existing long names must remain
visible without truncation, with any current editing limit explained.

## Adding several people

Owner direction, 21 October: attendance setup and the People directory should
offer the same understandable way to add one person, import a spreadsheet or
paste a list, while preserving the originating task. This is neutral person
creation, separate from the [reviewed student-enrollment importer](#reviewed-student-enrollment-import).
It does not create enrollment, employment, groups, app accounts or invitations.

The shared entry opens directly to Name, accepting one person or a pasted list
with one full name per line. Do not require an additional source-choice click for
routine entry. Import file remains a secondary action in that same sheet. Preserve
typed names when switching away and returning; never split a name at spaces or
commas. A single unambiguous name can be checked and added directly. For a list,
inspect the selected sheet/column and review names before any
creation. A supported-format and row limit must be visible. Parse files locally;
send only selected names for authorized name-match review, not contacts or unrelated
spreadsheet columns. An explicit new-person save may also carry the selected
optional descriptive connection, contact email and contact phone. Save these
atomically through the existing owning person command; never follow creation with
an unreported second contact write. Empty optional cells are omitted. Validate
against actual storage bounds (email 254 characters, phone 32); never truncate or
guess numeric phone values whose leading + or zero may already have been lost.
Reusing a specific existing person does not overwrite their contact details or
affiliations from the file. Those corrections stay in the revision-checked profile
workflow. The downloadable template includes at least ten synthetic people and
marks Name required and Connection, Email and Phone optional. It is not a universal
enrollment, employment, family-link or app-access import.
Do not execute formulas, macros or external links. Unsupported
formats and invalid/oversized inputs fail visibly rather than being guessed or
silently cut off.

Name matching is a warning, never an identity decision. Case/whitespace-normalized
matches within the file and among current authorized campus people require an
explicit choice: use a specific existing person, add a different person with the
same name, or skip. No automatic merge, first-result selection or account inference.
Candidate lists remain bounded and do not expose protected contact/family data.
If a chosen record changes or permission is lost, refresh the review rather than
silently substituting another person. Similar spelling is not proof of identity;
exact-name checking must not claim fuzzy or universal duplicate detection.

The initial bounded implementation may execute the existing per-person prepared
Core commands with stable per-row retry keys. In that case it must explicitly
report partial success and retry unconfirmed rows with the same keys; it must not
claim the enrollment importer's atomic batch semantics. Accepted rows retain their
normal owning person/DT identity and audit evidence. Closing or returning must not
hide accepted records, and selected-world imports cannot fall back to Live.

## Research and adopted patterns

Primary vendor documentation was reviewed on 20 October 2026. The adaptations
below are ThatCampus design decisions, not claims that another product implements
our DT or campus semantics.

| Primary source | Observed pattern | ThatCampus decision |
| --- | --- | --- |
| [Slack people and groups directory](https://slack.com/help/articles/360003534892-Browse-people-and-user-groups-in-Slack) | Search/filter people, open a profile, and browse groups to inspect their members. | One People/Groups entry; bounded directory and focused group detail, not repeated member lists across several directories. |
| [HubSpot record associations](https://knowledge.hubspot.com/records/associate-records) | Existing records can be linked to multiple other records; relationship labels and association history explain the connection. | Reuse a stable person, select an explicit existing counterpart and show purposeful connections with history. Do not copy optional automatic domain-based association for identity or authority. |
| [SAP organization structures and charts](https://help.sap.com/doc/4d95a5faa8cf48c7a801a338d9a9cc06/2605/en-US/SF_EC_Company_Structure_Overview.pdf) | Reporting/position structure is presented as a view of underlying people and organizational records, with scoped chart/search visibility. | Structure is a contextual view, not a mandatory person category or one universal hierarchy. Keep profile and relation visibility authorized. |
| [Microsoft Entra administrative units](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/administrative-units) | People can belong to several administrative scopes; authority over a contained group does not automatically confer authority over each member. | Membership, containment, reporting, app access and purpose-specific authority stay distinct. No permission inheritance merely from drawing or moving a group. |

These are documented product patterns, not firsthand usability certification of
the vendor applications. Existing ThatCampus screenshots and actual local flows
remain the acceptance evidence for the implementation.

## Relationships are typed facts not badges

- A tag is an optional benign search label. It cannot create enrollment,
  employment, eligibility, consent, disclosure rights or operational permissions.
- An affiliation is a dated descriptive association. It is not a class enrollment
  or permission grant, and one person can have several.
- A reusable participation group has explicit dated membership. Academic classes
  and organization units retain their respective owning lifecycle and identifiers.
- A person connection has reviewed meaning, direction/inverse, effective dates,
  same-institution scope, source/revision and correction history. Only supported
  kinds are offered. The initial new informational kind is mentoring; guardian,
  care and reporting semantics remain with their existing owners.
- An activity role such as attendee, lead or recorder applies to that activity.
  Assigning a recorder does not make them an attendee or grant recording access.
- App access is a separate explicit authentication-endpoint link. Responsibilities
  and authority remain current, scoped and purpose-specific.

Family/contact relationships do not imply permission to receive all records,
authorize leave, give consent or collect someone. Those powers retain explicit
owning validation, dates, restrictions and revocation. Adult/basic enrollment
must not universally require a guardian. Sensitive family/employment sections
must not be returned merely because someone can view a participant's name.

## Groups and structure

The default is a finite group list with counts, not every member of every group.
Group detail pages members and history. An optional structural view can reveal
supported containment or reporting context without making a graph editor the
entry experience.

Descriptive participation-group containment is distinct from organizational
reporting and academic enrollment. It is same-institution, effective-dated,
revision-checked and cycle-free. Multiple independent hierarchies are not forced
into one person parent field. Containing a group does not automatically include
its descendants' people, grant access or change any published activity roster.

Organization's existing department/team/position editor remains authoritative;
the first refinement must not create a second person-reporting tree or fabricate
employment to place someone in a generic group. Existing source-specific
bookmarks remain authorized and lead to the exact person/context where supported.

## Digital twin integration

People owns the authoritative person. Creation uses the prepared Core command,
owning transaction, typed accepted event and outcome to register its stable DT
entity immediately. A passive person is not an authenticated actor by inference.
The stable human agent and its account/channel endpoints follow the reviewed
human-identity lifecycle when that person can act or receive protocol work.
Synthetic behavior likewise needs approved institution configuration.

Groups and relationships use source-owned typed temporal projections. Many
memberships cannot be implemented by repeatedly replacing all relationships of
the same kind, or by circumventing the generic command's bounded edge limit.
Projection writes identify owning source, revision, precise interval and selected
environment; ending one link must not erase another source's valid link. Core
retains references/lineage, not copied family or employment records.

Normal domain invariants and current authority apply before mutation, including
exact retries. Accepted changes and their Core evidence commit atomically. Dates
and corrections retain the difference between effective time and recorded time.
Historical activity, attendance and signer snapshots are not reinterpreted using
today's names, membership or family arrangements.

Live and Simulation use the same APIs, screens, domain services and typed Core
ports bound to the selected store/clock. Person/group/relationship counterparts
are run-local, including newly created entities. Meaningful selected-world
changes must leave Live and sibling runs unchanged. Real account credentials,
membership issuance and email invitations remain explicitly Live control-plane
actions; Simulation cannot borrow those effects or silently fall back to Live.

## Verification and delivery

Delivery requires exact-person enrollment/guardian/employment attachment without
duplicates or implicit invitations; authorized bounded profile/relationship
disclosure; group pagination, dated membership and cycle prevention; retry,
stale-review, cross-institution and rollback checks; immediate DT registration;
and actual COW source-owned relationship mutation with unchanged Live/sibling.
The common UI must be checked in blue Live and amber Simulation, including direct
links, back paths, empty states, recoverable errors and mobile interaction.

The implementation plan records completed slices and remaining gaps. This
contract is not itself proof that every adapter, import format, relationship
kind, organizational structure or deployment gate has shipped.

## Reviewed student enrollment import

This purpose-specific import creates enrollment and family records; it is not the
neutral names importer above, an account-provisioning tool or a mass-update tool.
Use the authorized People enrollment-import action with an existing academic term
and classes. Current administrator authority is rechecked at every API and commit.
Additional access through a delegated role requires its owning authorization, not
inference from a visible import button.

Download the template and upload UTF-8 CSV, bounded to 512 KB and 500 students.
Malformed quoting or wrong headers fail before creating a draft. One row represents
one student and one primary guardian. Column order may vary; names must match:

| Columns | Contract |
| --- | --- |
| `admission_number` | School-unique, case-insensitive; 2–64 letters, numbers, slashes or hyphens. |
| `first_name`, `last_name` | Retained enrollment-import schema; last name may be empty. Neutral People entry still uses one Name and does not infer name boundaries. |
| `date_of_birth` | `YYYY-MM-DD`, before enrollment and not in the future. |
| `class` | Existing class label in the selected term's academic year. |
| `roll_number` | Integer 1–32767, unused in that class and term. |
| `enrolled_on` | First roster date, `YYYY-MM-DD`, inside the term. |
| `guardian_key` | Optional explicit within-file family reference; letters/numbers/underscore/hyphen, maximum 64 characters. |
| `guardian_first_name`, `guardian_last_name` | New guardian identity; last name may be empty. |
| `guardian_phone`, `guardian_email` | Contact for a new guardian; email optional. |
| `relationship` | `mother`, `father` or `guardian`. |

Review per-row results, correct included rows or explicitly skip them, then review
the exact included students, family links, dates and skips before confirming.
Existing admission numbers are never overwritten. Select an existing guardian
only after verifying that person; search results are never auto-selected. Reusing
an existing guardian uses its canonical record, not replacement CSV contact data,
and grants no leave-signing authority. A repeated `guardian_key` may identify
siblings only when name/contact facts or the selected existing guardian agree.
Blank keys create separate guardians. Name/phone similarity is only a warning.
This bounded legacy schema does not make a guardian universally compulsory for
all campus people or adult enrollment.

The complete selected batch commits atomically or not at all. It creates native
student/person, guardian/person, relationship and enrollment links with scoped
foreign keys; accounts remain optional. No marks or attendance observations are
invented; new subject-attendance aggregates start with zero recorded classes.
Roster-effective dates govern visibility. Affected submitted registers return to
Draft with marks preserved and roster-change audit; a locked register blocks the
batch until an authorized reopening or corrected start date.

Upload retries retain an upload key; final retries retain the reviewed revision
and token and return the original receipt. Row edits reject stale revisions;
commit repeats identity, roster, guardian and finality checks under ordered locks
and compares the exact review snapshot. Writes, audits and outbox facts share one
transaction, with bounded batched inserts and no remote calls while locked.
Draft updates notify only current campus administrators; committed class updates
reach authorized administrators, assigned teachers and linked guardian accounts.
Events contain IDs, never raw imported contacts, and use normal cache invalidation.

Raw rows expire after 24 hours: a bounded sweep and opening an expired draft clear
them. Cancel and commit clear raw input immediately. Minimal batch history and
committed enrollment references remain; backups have an independent retention
lifecycle. Reports require current permission, `Cache-Control: no-store`, explicit
download and spreadsheet-formula neutralization. Sensitive CSV rows are not copied
into audit payloads.

The importer accepts CSV only, not XLSX or arbitrary column mapping, and handles
one primary guardian rather than custody/second-parent imports. Further family
links, record corrections, invitations and progression retain their owners. It
does not roll back committed people by deletion. Acceptance includes isolated
200/500-row batches, malformed/oversized input, explicit identity selection,
stale/duplicate commands, cross-campus denial, locked-register blocking, rollback
and event privacy. Local timings are not a managed-PostgreSQL load guarantee;
institution process review and production non-owner RLS/backup policy remain gates.

## Connected student enrollment lifecycle

An enrollment decision changes a durable canonical person's placement, not their
identity or unrelated academic, financial, family, transport or care history.
The supported bounded operations are Move class, Withdraw and Transfer out.
Each ends the current placement on campus-local today with an audited reason;
Move creates a new placement in the same term with a reviewed class and roll.
Bulk next-term progression uses its own Promote class review. Future-dated
lifecycle scheduling needs date-aware readers or a reviewed transition runner and
is not supplied by this slice.

Load the current enrollment and ordered history. Preview checks `sis.manage`,
current enrollment ID/revision, local date, same-term target, roll availability
and affected attendance finality, then stores a 30-minute input/impact review
without changing the roster. Commit locks review, campus authority and the student
advisory boundary and repeats those checks. An identical retry returns its receipt;
stale or expired reviews require fresh review. Impact counts identify submitted
registers, upcoming non-final assessments, active transport and open departure
plans without claiming those downstream records were changed.

`is_active` identifies current placement; `inactive_from` is exclusive, so an old
placement is valid before that date and a replacement begins on it. `exit_kind`,
`exit_reason`, `ended_by`, `ended_at` and `revision` retain decision evidence.
Partial uniqueness permits same-term history but enforces one active placement per
student/term and one active roll per class/term. Legacy inactive rows may be marked
`term_completed` with unknown actor rather than fabricated provenance. There is
no hard-delete action.

After explicit confirmation, bounded mechanical propagation reopens affected
submitted registers as Draft with marks preserved; final registers block it.
Destination aggregates are initialized without deleting source aggregates. Native
lifecycle/register audits and a scoped `people.updated` fact commit together.
No account, guardian power, money, consent, transport assignment or safeguarding
authority is terminated automatically; impact is a handoff to its owner.

Verify movement, withdrawal/transfer, history, stale/duplicate review, roll conflict,
tenant denial, final-register refusal, draft reopening and atomic audit/events in
`backend/test/people-lifecycle.integration.test.ts`, plus authorized phone/keyboard
flows and meaningful selected-world isolation. The migration and test source are
not themselves fresh-release evidence; record actual deployment/device limits in
the current delivery record.
