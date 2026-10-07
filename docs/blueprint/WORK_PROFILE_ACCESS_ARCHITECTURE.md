# Roles and contextual assignments

Decision: 7 October 2026. This supersedes the work-type/immutable-workflow-alias proposal.
Status: implemented locally with automated verification; physical phone/product acceptance remains required.
Applies to schools, colleges and coaching centres.

## Product model

| Concept | Meaning | Example |
| --- | --- | --- |
| Position | Descriptive employment information; never a permission grant | Mathematics teacher |
| Role | A named bundle of supported actions | Class mentor, Assessment reviewer |
| Assignment | Person + role + resource + effective dates | Kavita → Class mentor → Class 7A |
| Workflow | The actual process in the owning module | Enter marks → review → publish |
| Cover | A temporary, accepted operational assignment | Cover Tuesday's second lesson |

One person can have multiple assignments. Permissions are additive, within each assignment's
scope. A narrow role does not subtract rights granted by another active role. The staff profile
shows all the contributing assignments so an administrator can see this.

A role is not an employment designation, workflow, eligibility gate or institutional authority.
There is no separate work-type catalogue and no duty-to-role eligibility matrix.

## Simple administrator experience

One entry: **Staff setup & leave**, with **People / Roles / Leave / Settings**.

- People opens a separate staff profile. Assign a ready-made role, choose the class (and optional
  subject) or institution scope, then dates. No permission selection is required for normal staffing.
- The profile groups assignments by role, not one full card per exam or journey. Assigned,
  Not assigned and History views show which roles are held or missing; search finds exact scoped
  work. Scheduled/offered states remain explicit and history is read-only. Role totals count
  distinct role IDs, while assignment counts retain the individual authoritative records.
- Roles lists built-in templates and institution custom roles. Customise a template or start blank,
  name the role, choose its resource context and select supported actions in plain language.
  Required read permissions are selected automatically. This is a real permission bundle, not a
  renamed template with hidden immutable permissions.
- Exam, event and journey staffing stays in those planning screens. Those same records appear on
  the staff profile automatically. An administrator can change their access role there without
  creating another assignment or eligibility record. Replacing the assignee remains a domain action.
- Staff see **My work**. Onboarding is collapsed after completion; leave and coverage keep their
  existing screens. The role model does not redesign navigation, headers, themes or other domains.
- Changing a custom role's actions shows how many existing assignments will change and requires
  confirmation. Current revision and assignment count are checked again by the server.

## Supported resource contexts

| Context | Supported action families | Assignment owner |
| --- | --- | --- |
| Institution | Ordinary member invitations, student records, fees, departure planning, communication, AI | Staff profile |
| Class | Attendance, photo attendance, timetable, follow-up, communication, report remarks, class activities/tests, AI | Staff profile / existing class staffing |
| Event | Event read, bounded management, session attendance | Event plan |
| Assessment | Read, marking OR independent moderation | Assessment plan |
| Journey | Operating the assigned trip | Journey roster |

Only implemented platform actions are selectable. Custom roles cannot create new software
operations, an arbitrary workflow engine, administrator membership, institutional approval
authority, safeguarding case access, publication powers or unbounded data access.
Assessment roles cannot combine marking with independent review, or give an examiner the
moderator's actions. Existing workflow-state and independence checks remain in force.

## Storage and migration

Migration `052_scoped_access_roles.sql` evolves the existing physical
`staff_responsibility_types` table into a contextual role catalogue. Its old name, code and
clone lineage are compatibility details, not additional product concepts.

- `context_kind` identifies the supported resource boundary.
- `capability_permissions` is editable for institution roles. Built-in permission bundles remain
  platform-owned. A custom role need not have a template.
- `staff_responsibility_assignments` stores direct institution/class bindings.
- Native class, event and assessment staff records have an optional `access_role_id`; journey
  records have separate primary/backup overrides. Null uses the slot's standard role.
- `staff_role_bindings` is a read-only union of those authoritative records, not another writable
  assignment table. Profiles, effective-access explanations and scoped checks share it.
- Native assignment access revisions prevent stale updates. Ending a class assignment retains its
  historical record. Replacing a trip collector clears that former person's custom override.
- Existing unrelated records are not deleted or reset. Earlier work-type clones become editable
  custom roles with their supported context.
- The old create/edit work-type HTTP routes return 410 with an upgrade message. Older physical
  role/eligibility tables and compatibility endpoints may still exist, but are not consulted by
  operational authorization and are not exposed by the current setup UI.
- Free-text exam, transport or safeguarding duties are not a substitute for domain staffing and
  cannot activate those modules. Unsupported historical tasks remain historical work, not access.

The server-only projection is not granted to PostgREST's anon/authenticated roles. Its
PostgreSQL-14-compatible ownership follows the application tables. This does not claim the
separate non-owner-runtime/RLS deployment gate has been completed.

## Authorization contract

Every command needs an active account and institution membership, a matching permission on
the same scoped binding, and the owning module's current workflow checks.

Never combine an action from Class A with a read-only relationship to Class B.
A UI route or visible button is not authority. Position and old eligibility rows are not grants.

- Class actions use the class permission resolver; reports and class-test planning additionally
  check their native subject/date/workflow conditions.
- Teaching a class no longer automatically grants marking access to every assessment.
- Actual examiner/moderator assignments determine assessment scope; role overrides can reduce
  actions but cannot swap their procedural meaning.
- Trip identity, assignment acceptance, rider scope and journey state remain required.
- Messaging rechecks the class/student context and current participants. Automatic class groups
  acquire an explicit class relationship; membership in an old conversation is not a lasting
  authorization grant after a class role ends.
- Attendance follow-up resolves the student's current class permission.
- Built-in legacy timetable-only relationships retain their prior teaching access only where
  no explicit class binding exists. An ended or disabled explicit binding prevents that fallback
  from resurrecting access. This is a compatibility bridge, not a new setup choice.
- Dated support exceptions remain an internal continuity mechanism; they do not bypass the
  owning domain's resource or workflow checks.
- Governance offices, seats, delegations and resolutions remain separate. Editing software
  access does not authorize institutional decisions.

Role/assignment changes are transactional, tenant-scoped, audited and emit access-update events.
Role edits lock and recheck assignment impact; native assignment updates use current revisions.
Demo seeding is add-only for the new example and does not reset administrator edits.

## Verification and release boundaries

Required evidence: fresh migration plus demo seed; current-institution provisioning; built-in
and custom role creation; prerequisite handling; cross-tenant denial; native assignment changes;
stale-edit rejection; immediate revocation; same-resource action checks; audit/outbox records;
staff-profile links; mobile layout and keyboard dismissal.

The implementation plan records actual results. Local tests are not proof of a production
deployment, legal compliance, physical device acceptance, or completion of every blueprint domain.
