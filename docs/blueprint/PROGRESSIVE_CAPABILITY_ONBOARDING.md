# Progressive capability onboarding

Status: accepted product contract, 18 October 2026. This decision supersedes the
archived two-lane formal-institution-versus-coaching entry flow and universal
pre-operation activation gate. Those earlier proposals are not active contracts.

21 October extension: [End-to-end campus workflows](END_TO_END_CAMPUS_WORKFLOWS.md)
preserves this promise across all 22 owner stories. It defines the expanded target,
not delivered capability. New journeys use this same onboarding and theme contract.

26 October extension: [Whole-campus guided setup](WHOLE_CAMPUS_GUIDED_SETUP.md)
defines the optional resumable whole-campus starting point. It asks for no complete
campus information upfront; contextual detail and existing imports grow the same
canonical campus over time. Choosing this guide alone does not select every goal.

## 1. Product promise

> **Start anywhere. Build the whole campus as you go.**
>
> Choose one or several things to run first. This only shapes where we start; nothing is
> locked. People, places, schedules and rules you add once are reused everywhere, so you can
> grow from one register or gate to a connected campus without starting over.

This promise must be visible before the first setup question. A person selecting **Entry & exit**
is not buying, creating or being confined to a gate product. They are choosing the first useful
view into one ThatCampus system. Attendance, timetable, examinations, communication, staff
coordination and future supported capabilities remain available to add to the same campus.

## 2. Decisions the first answer makes — and does not make

The purpose selection may determine:

- the first domain journey and suggested order;
- which minimum prerequisites are requested now;
- which demo examples and initial Today cards are most relevant;
- which selected outcome is offered first when several share setup work.

It must not determine:

- institution type, legal form or education stage;
- a permanent module bundle, price edition or tenant type;
- whether another capability can be used later;
- a second people, class, place or schedule catalogue;
- organisation verification status;
- permanent navigation hiding.

Capability activation is additive and reversible. Selecting several outcomes produces a shared
route: for example, Attendance and Entry & exit collect people once, then reuse those identities
in both operations.

## 3. The first question

Use domain outcomes, not internal modules or organisation categories.

**What would you like ThatCampus to help you run?**

- Attendance
- Entry & exit
- Timetable & classes
- Examinations
- Student performance
- Staff coordination
- Messages & family communication
- My whole campus
- Just explore

The control is multi-select. Directly beneath it, say:

> **Choose one or several. This only decides where we start — every ThatCampus capability stays
> available.**

`My whole campus` is a request for a guided progressive plan, not a request to complete every
catalogue before entering the product. `Just explore` opens a safe, representative product tour
or demo without fabricating a customer campus.

As supported workflows expand to admissions, fees, clubs/events, services,
placements and completion, organize the outcome catalogue into understandable
groups with search/progressive disclosure. Do not show 22 unqualified working
tiles. Distinguish implemented, preview and planned outcomes; a selected plan
cannot enable an absent workflow. Whole-campus guidance recommends an initial
two or three outcomes and can be paused/reordered; it never creates another realm.

Do not ask **school or college?**, **coaching or organisation?**, **which package?** or **what is
your campus name?** before this question.

## 4. Identity and trust are progressive

The minimum persistent-account step is an email address, phone number, passkey or approved SSO
identity. A public product demo can precede it. Account possession/security and organisation
verification are distinct.

On founder account creation, ThatCampus creates:

- a stable account/person identity;
- a private provisional operational realm/workspace identifier;
- a provisional owner/administrator context bounded to that private realm;
- no claim that the user represents a verified institution.

This is not the applicant/join entry contract. A public admission link binds the
application to its destination campus. Applicant authentication must not create
another campus, enroll the person or grant broad member/administrator access.
Signed invitations supply the intended person, scope and supported acceptance;
recipients cannot choose their own powers. Assisted completion retains the true
officer's action and the same applicant case. Explicit identity resolution and
account links remain required; name/email resemblance is not authority to merge.

The founder context is established through the narrow audited bootstrap in Model
Core §15.4. Perform only the authority ceremony needed for the first chosen
private operation. Full governance structure and public verification are not
prerequisites. Retain required independent approval and any explicitly permitted
single-founder exception; never convert bootstrap into permanent super-admin.

The internal identifier is not a user naming task. Until an outward-facing name is needed, the UI
can say **Your campus** or use the selected operation's domain language.

A campus person can participate without signing up. Optional **Invite to app**
belongs beside that existing person, not in a compulsory staff/student setup
wizard. Ask only for the recipient email, then let the recipient authenticate or
set their own account password through the email-bound invitation ceremony.
For neutral `member` invitations, new or email-unverified accounts must also
confirm a fresh mailbox code issued after opening the invitation; possession of
the original complete invitation is not independent mailbox proof. Never expose
that separate code to the sender, API client, demo mode, logs or Model Core.
Unavailable delivery fails closed. A verified existing account still proves its
current password. The legacy role-specific invitation ceremonies are not yet
covered by this additional proof and remain a separately recorded migration gap.
Link the same canonical person and human agent; never create a second
person, infer enrollment or manufacture a staff profile to obtain app access.
The neutral `member` context grants no operational authority automatically.
Stable app identity is not a temporary visitor entitlement: each job, building
or service keeps its own current scope, dates, revocation and retained-obligation
policy. Joining opens the accepted campus's shared work, not founder setup or a
new visitor portal. Existing engagement-specific continuation is a later owning
domain contract, not an arbitrary user-supplied redirect.
Show **Invitation pending** until acceptance, and **App account · You** for the
current linked owner even after their campus-person name is corrected. Inactive
retained access is not a new invitation opportunity. Manage/resend/revoke stays
contextual to that person and requires current invitation authority.

These credential/membership actions run only in Live. A selected Simulation uses
captured identity facts but cannot issue real app invitations or silently borrow
Live account-control effects. Email delivery availability is reported truthfully;
creating an invitation or an email provider accepting it is not recipient
acceptance and is not proof that app access has been activated.

Ask **What should staff and families see?** only when a display name has a concrete consumer, such
as an invitation, outbound document/message, second location, branding surface, invoice or
verification request. Ask for terminology at its point of use — for example, **What do you call
this group? Class, batch, course, or something else?** — rather than asking the person to classify
their whole organisation.

Organisation verification lives inside the working app as a trust task. Its neutral state is:

> **Not verified — your private work continues. Verify when you need trusted organisation
> features.**

Verification may gate a verified badge or public claim, a claimed email domain/SSO connection,
regulated payments, or an approved external integration. Each boundary names the exact benefit
and evidence needed. It does not erase, freeze or invalidate private work.

## 5. Progressive-campus diagram

```text
                         WHAT DO YOU WANT TO RUN FIRST?
              Attendance   Entry & exit   Timetable   Exams   …
                    \           |             |        /
                     \      choose one or several     /
                      v                              v
             +------------------------------------------------+
             |              ONE CONNECTED CAMPUS              |
             |  People · Places · Groups · Schedules · Rules  |
             |                 Evidence · History              |
             +------------------------------------------------+
                         |                         ^
            ask only what the first job needs      |
                         v                         |
                 RUN A REAL OPERATION              |
                         |                         |
                         +--- ADD THE NEXT ONE -----+

       Campus name · structure · terminology · verification
                 are added only when actually needed.
```

Selected outcomes are labelled **Start here**. Unselected outcomes are labelled **Add anytime**.
The visual must never imply separate products orbiting an empty hub; it communicates one growing
model in which every completed operation enriches the same campus.

## 6. Acquisition-to-first-value story

This ten-beat story preserves the strong approach of the first onboarding journey pack: show the
real product, let a person understand it through a role perspective, and reach a genuine outcome
before asking for broad setup.

1. **Promise:** an ad or recommendation says ThatCampus can start with one campus job and grow.
2. **Product proof:** the public site shows real connected workflows and offers a no-form demo.
3. **Demo perspective:** the visitor may view Principal/admin, teacher, gate operator or family
   examples. This personalises the demo only; it does not assign their real role.
4. **Real product moment:** the demo performs a connected task and shows the downstream result.
5. **Keep your work:** the person supplies only email or phone to create a private workspace.
6. **Purpose:** they select one or several outcomes to bring into ThatCampus first.
7. **Connected promise:** the progressive-campus diagram shows Start here, Add anytime and the
   shared foundation. If several outcomes are selected, ThatCampus recommends the shortest shared
   path and lets the user change priority.
8. **Minimum setup:** the selected domain asks only for prerequisites needed for its first real
   operation, reusing or importing existing data where possible.
9. **First outcome:** the user performs the operation in the normal workspace — not a setup-only
   mini-app — and sees an accepted result.
10. **Progressive operation:** Today opens with the result, useful next steps and a quiet path to
    Campus setup. Other capabilities remain visible as Add anytime; verification is a separate
    trust task, never a universal blocker.

## 7. Minimum paths by outcome

| Starting outcome | Ask now | Do not ask yet | First accepted value |
| --- | --- | --- | --- |
| Attendance | group/class label, participants, responsible person or current operator, attendance method | buildings, fees, exams, full academic year, organisation type | submit the first register |
| Entry & exit | entry point label, operator/device method, a person or import strategy, exception owner if the rule requires one | classes, subjects, timetable, campus legal profile | record the first accepted entry/exit |
| Timetable & classes | groups, sessions, available people/places only as used | every room/resource, finance, verification | publish or test the first bounded schedule |
| Examinations | candidate group, subject/assessment, date/window, responsible person | unrelated daily timetable, gate topology, full staff directory | create the first valid examination plan |
| Messages | sender context, first audience, delivery/consent requirements for that channel | full campus topology, unrelated learners/staff | send or safely queue the first message |
| Whole campus | choose the first two or three operational outcomes and show their shared route | a universal completion checklist | complete the first outcome and retain the expansion map |

Prerequisite resolution classifies every requested item as reusable, required now, optional later,
conflicting/duplicate or unavailable by authority/rule. The journey explains why a required item is
needed and returns to the same outcome after it is supplied.

### 7.1 Readiness for an action, not an institution-wide count

Qualify readiness by requested operation, actor, scope, selected world, source
revision and effective authority/rules. A staff member or examination existing
somewhere on campus does not establish readiness for this person's action.
Distinguish enabled, ready to operate and first operation accepted. Setup saved is
not a submitted register, confirmed payment, issued loan or accepted offer.

Each new capability extends the existing pack contract with domain-owned
prerequisite results, ordinary action destinations, permitted responsibility
templates, work projections, closure/correction, export/disable/history behavior
and Live/Simulation acceptance. The expanded minimum-setup table and all-story
endings are in [End-to-end campus workflows](END_TO_END_CAMPUS_WORKFLOWS.md).

## 8. In-app progressive setup

Campus setup is organised around:

- **Working now** — capabilities with enough accepted data to operate;
- **Useful next** — the smallest additions that unlock a user-selected next outcome;
- **Available anytime** — the wider ThatCampus capability catalogue;
- **Trust & connections** — organisation verification, domains, SSO and integrations when useful.

There is no universal campus-completion percentage. A one-room operator running attendance can be
fully ready for Attendance without branches, transport or examinations. Readiness is per outcome
and uses accepted data, not manually ticked setup boxes.

### 8.1 Operating continuation and preferred landing

Completing setup must hand the person into the real operation without subsequently losing that
context. When the owning domain accepts the first capability setup, the same transaction records a
server-backed **operating resume** containing its vetted goal and destination. The resume is campus
state, not a browser-only convenience and not proof that the first operation itself has occurred.

Root entry, login and a refreshed account page may use that resume only when all of the following
remain true:

- the workspace is ready and the resume is in its operating state;
- the goal is a recognized progressive capability and the path is the reviewed destination for that
  goal;
- the selected institution, membership and current authority still permit the destination; and
- normal destination guards and server authorization recheck access.

An arbitrary stored path, a mismatched goal/path pair or a stale capability is ignored in favour of
the current safe role home. The resume is a **preferred landing**, not a module entitlement, product
edition or permanent navigation restriction. Changing the primary outcome or deliberately opening
another authorized workspace remains possible, and every other capability stays available to add.

Profile, Appearance and Account security are reversible account surfaces, not a change of operating
context. When opened from an authorized application screen, their Back action preserves the exact
safe same-origin path, query, fragment, history and campus context. A direct or refreshed account
URL may reconstruct that vetted return path; absent or invalid provenance falls back to the
server-vetted operating resume or safe role home. Theme changes must never reset the person to a
generic dashboard.

Timetable continuation identifies one exact source plan and revision. An accepted
editable draft remains **first use**, not a published operation; the owning
publication is what advances it to operating. Automatic personal continuation is
qualified by the current account's ownership, identity and scheduling authority,
not a campus-wide draft count or another administrator's last destination. Other
currently authorized managers may still deliberately open a shared draft through
the owning workspace. A stored URL never creates that authority.

On return, re-read the plan in the selected world. A changed revision requires
review of current truth before editing; a foreign, unavailable, discarded or
no-longer-authorized source offers recovery without creating a replacement. An
accepted draft followed by an unconfirmed publication must retain that draft's ID
and safe retry path, rather than reopening an empty editor. Publication opens the
dated schedule and, when explicitly required and permitted, its exact attendance
register. Saving a timetable must not change a different selected primary goal.
Simulation uses the same domain flow but never writes Live's onboarding resume.

For an authorized operator who starts with **Entry & exit**, the initial and resumed
destination is the normal **In & Out** workspace. Its content is prioritized inside
the stable **Today / Work / Areas / More** shell; the starting outcome never replaces
or reorders that shell. It does not create a gate-only role or hide later capability.

### 8.2 Prerequisite continuation and themed entry

Retain a server-vetted continuation for actor, realm, selected world, outcome,
operation/scope, source draft/revision, missing prerequisite and permitted return
destination. Recheck authority/revisions on return. It is not an arbitrary redirect
or authority grant. Preserve selected people, names/import, draft, page/filter and
originating task when a prerequisite sheet completes or is cancelled. World changes,
revocation and expiry require explicit recovery, not a cross-world pending write.

The founder's purpose tiles, compact approved campus graphic, shared inline
select/create/import, short decision groups and concise review lead into the real
domain workspace. Joining/applying skips founder-purpose setup and resumes the
exact invited duty/application. Use the shared theme, depth, feature identities,
Name chips/collision choices, circled-i help, 16px fields, 44px targets and
keyboard/safe-area-aware sheets. One primary action and truthful next-owner/receipt
replace repeated instructions or a parallel onboarding design system.

## 9. Migration and acceptance rules

The current formal/coaching selector and universal activation gate are legacy implementation, not
the target. Convergence must preserve secure account/session handling, audit history and useful
prerequisite computation while removing the category and verification walls.

Acceptance requires:

1. a new user reaches purpose selection without entering organisation type or campus name;
2. two or more outcomes can be selected;
3. the UI states that selection prioritises setup and never limits future capability;
4. an internal private workspace is created without a public institution claim;
5. at least Attendance and Entry & exit complete their minimum real operation independently;
6. a shared person/place entered once is offered for reuse by the next capability;
7. no capability silently creates a duplicate person/group/place store;
8. leaving verification incomplete does not block private core operation;
9. a trust-sensitive action explains and deep-links to the exact missing verification evidence;
10. adding a capability returns to the real domain journey rather than a generic setup maze;
11. the normal app shows Working now, Useful next and Available anytime without a universal score;
12. account security, authority, tenant isolation and abuse controls remain enforced throughout.
13. accepting first-capability setup and its operating resume is one owning-domain transaction;
14. login, root entry and refresh use a resume only for a recognized and authorized goal/path pair;
15. Profile, Appearance and Account security return to the exact safe originating operation;
16. invalid or external return provenance cannot become a redirect and falls back safely; and
17. Gate-first content prioritizes In & Out without changing the stable Today / Work / Areas / More shell;
18. founder, applicant, invitation and responsibility entry do not manufacture one another's campus or powers;
19. each supported new outcome can begin with its own minimal valid setup and later reuse records in another;
20. prerequisite continuation returns to the exact authorized draft/action, including expiry/revocation/world recovery; and
21. whole-campus guidance and a one-workflow start reach the same domain records and all applicable end-to-end acceptance gates.

## 10. Research rationale

The interaction follows established progressive-onboarding principles: teach by doing in the real
experience, ask only for information needed by the current task, let intent personalise a starting
state without becoming permanent scope, and collect trust evidence incrementally at the action that
requires it. External references supporting this decision are listed in the accompanying design
story paper under `design/progressive-onboarding-story/`.

## Company provisioning and invitation operations

Company operator is separately granted backend authority, not a campus role,
signup choice or permission checkbox. It permits institution metadata/provisioning
and company invitations, never student rosters or campus operational access. A
company operator does not automatically become a member of a provisioned campus.
The company-managed creation path and purpose-first founder path are distinct;
neither restores the retired formal/coaching selector or universal activation gate.

Institution creation and its first-admin invitation commit together. Codes are
hashed, recipient-email-bound, single-use and revocable. Current company-admin
codes expire after 30 minutes; this supersedes the old 72-hour description.
Redemption activates a new account or requires the existing account's password;
it never overwrites an existing password. Recheck the original inviter's current
authority on acceptance; revoked operator/delegated rights invalidate pending
codes. Institution/account/person locks and scoped relational keys protect races
and cross-campus attachment. Pending role invitations block role deletion until
revoked/expired. Initial role choice cannot create institutional decision power.
Campus member invitations attach the explicit existing canonical person; they do
not duplicate learners/guardians or infer relationships. The additional independent
mailbox proof and remaining legacy ceremony gap are specified above.

Use the existing active company account and deployment-managed connection to grant
or revoke operator status. No application endpoint grants this role:

```sh
cd backend
node --import tsx src/database/company-operator.ts grant operator@company.example
node --import tsx src/database/company-operator.ts revoke operator@company.example
```

The CLI checks an existing active account, records the company audit and creates
neither an account nor a password. `DATABASE_URL` stays in the managed environment,
never chat/source/logs. Grant only authorized company personnel; requests and
pending invitations recheck the current grant. Synthetic company operators are
development fixtures only; production forbids demo-mode seeding. Provisioning a
college does not implement course/credit administration beyond existing owners.

### Invitation delivery security

Company first/replacement-admin and supported campus invitations enqueue mail in
the invitation transaction; the configured server worker sends after commit.
Trusted canonical HTTPS `PUBLIC_URL` builds
the join link; no private code is placed in that URL. Branded HTML and plain text
include recipient, code and expiry. The join button neither redeems a code nor
proves acceptance. Provider acceptance, unconfirmed send and recipient joining are
separate states; manual sharing is only the explicitly permitted original invite,
never the independent mailbox-proof code.

Configure `INVITATION_EMAIL_ENABLED` and the approved SMTP or HTTPS provider through
managed secrets. SMTP requires verified sender/account ownership, valid TLS and,
where applicable, an app password rather than the ordinary account password.
HTTPS mail uses a verified sender domain; test senders can restrict recipients.
Provider/platform SMTP restrictions must be checked for the current deployment,
not copied from obsolete Railway/GCP host instructions. No embedded demo SMTP
fallback, personal mailbox address or stale hostname is a runtime requirement.

Safe failure categories must not log raw SMTP/provider responses, credentials or
private codes. `enqueueInvitation` deduplicates by invitation and token hash and
temporarily encrypts the sendable code with a domain-separated key and invitation
ID binding; it is not stored as plaintext. Disabled mail returns the explicitly
permitted manual-invitation state, not an email-delivered claim. The bounded worker
claims queued jobs and checks current token, expiry, revocation/acceptance and any
source-specific work grant. Cancelled or terminal jobs clear encrypted material.
An interrupted sending job becomes `unknown` after two minutes; unconfirmed sends
are not blindly repeated because the provider may have accepted them. Confirmed
authentication/recipient failures remain failed, distinct from ambiguous delivery.

Explicit resend rotates the code/token and enqueues a fresh reviewed job; company
resend has a one-minute cooldown and current operator checks. Replaced old jobs
cannot deliver an outdated invitation. This is a durable delivery queue, not a
guarantee of inbox arrival or automatic successful retry. Real inbox,
replacement/revocation, current-inviter authority and recipient acceptance require
separate evidence from a passing provider-fake test. Simulation records its
isolated provider-effect receipt without deliverable codes, encrypted external
jobs or Live mail; it cannot borrow the real account-control flow.
