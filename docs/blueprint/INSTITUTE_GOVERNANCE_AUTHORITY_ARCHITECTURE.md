# Institute governance, authority and mobile operations

Status: adopted architecture; authority foundation implemented locally on 7 October 2026

Applies to: schools, colleges, coaching centres and hybrid institutions
Primary specification: `Institute_Configuration_and_Operations_Framework_V2_1.docx`

## Product decision

OmniSchool has one institute model and two management experiences:

- **Institute Setup** records how the institute is organised, where authority comes from,
  who currently holds offices or body seats, which matters are reserved, and which
  routine work is delegated.
- **Daily Work** presents the concrete teaching, service, review, decision,
  implementation and oversight actions that the current person may perform.

Application access and institutional authority are separate. An administrator may
prepare a governance configuration without having the power to adopt it. A software
role cannot appoint a principal, create a committee seat, supply a vote or transfer a
reserved decision.

## Human experience and automation contract

The user supplies only facts that the product cannot safely know:

1. The legal operator and applicable institution context.
2. The current holder of a main office or seat.
3. The source or evidence for material authority.
4. An institution-specific deviation, limit or final authorised decision.

The product derives or prepares everything else it can explain:

- a suitable school, college or coaching starting structure;
- offices, bodies, seats and vacancies;
- work-profile recommendations and scoped responsibility requirements;
- standing-mandate and reserved-matter suggestions;
- the plain-language **Who can decide what?** map;
- review tasks, expiry reminders, blocked-authority explanations and impact previews.

Generated records retain their template and source. They remain suggestions until the
required authority confirms them. Automation must never silently create authority,
adopt a governance rule, invent a meeting, fabricate evidence, infer a legal conclusion
or show an unaccepted offline action as recorded.

## Unambiguous model

| Concept | Product meaning | It does not grant |
| --- | --- | --- |
| Person | Human identity, with or without an account | Login or authority by itself |
| Account type | Administrator, staff, guardian or learner portal boundary | Job title or institutional office |
| Work profile | Work the person is eligible to receive | Current work or reserved decision power |
| Responsibility assignment | Actual dated work in a typed scope | Work outside that scope |
| Capability pack | Platform-owned permissions needed for a responsibility | Institutional decision authority |
| Access exception | Dated, reasoned technical exception | Office, committee seat or vote |
| Authority source | Governing instrument, rule, order, resolution or declaration and its status | Authority until its applicability and state support it |
| Office | Continuing individual institutional position | A specific officeholder without an appointment |
| Body | Continuing collective authority or advisory group | A completed collective decision |
| Seat | Defined place in a body, possibly vacant | Membership without an appointment |
| Appointment | Effective-dated connection from a person to an office or seat | Power outside the office/seat and source |
| Mandate | Bounded standing or delegated power | Power beyond its source, matter, limit or period |
| Decision matter rule | Complete route for one institutional matter | A decision on a particular proposal |
| Decision case | Versioned proposal and required decision work | Resolution before the procedure completes |
| Resolution | Adopted outcome of an authorised procedure | Unlimited execution permission |
| Decision authorisation | Bounded mapping from a resolution to a domain command | Other commands, targets, amounts or versions |

## Access and authority evaluation

Technical access uses the model in
[Work profiles, assignments and calculated access](WORK_PROFILE_ACCESS_ARCHITECTURE.md):

```text
active account and membership
AND protected administrator authority, or an active eligible responsibility,
    or an active dated access exception
AND owning-domain resource and workflow checks
```

A material institutional action adds a second, independent test:

```text
technical access is allowed
AND a current standing mandate or decision authorisation covers this matter
AND its source, holder, target, limits, dates, conditions and version match
AND any independent or external decision is complete
AND the domain command invariants hold
```

The server evaluates both. Navigation is a projection, not an enforcement boundary.

## Setup states

Authority records use explicit states. A saved draft must never look adopted.

- Source: `draft -> recorded/self_attested -> verified -> superseded`.
- Office, body and seat: `proposed -> active -> retired`.
- Appointment: `proposed/future -> active -> suspended/ended`.
- Mandate: `suggested -> active -> suspended/revoked/expired`.
- Decision matter rule: `suggested -> confirmed -> retired`.

`self_attested` is an honest source state for a small owner-operated coaching
workspace. It does not claim regulator or platform verification. A verified institute
records its actual instrument and review evidence. Selecting a simpler template cannot
remove a body or step required by an applicable source.

## First authority foundation slice

Migration `048_governance_authority_foundation.sql` adds source-backed, institution-
scoped authority records with typed foreign keys, uniqueness checks, effective dates,
optimistic revisions, RLS and no browser-role table grants.

The principal governance workspace now starts with **Authority** and shows:

- source status and issues needing review;
- current offices and officeholders;
- bodies and visible seat vacancies;
- a concise **Who can decide what?** map;
- a four-fact setup form when no authority structure exists.

The setup command prepares a draft from the institution profile. For a self-service
coaching workspace, the source is explicitly self-attested. For a managed or verified
institution, the source and generated records remain recorded/proposed until the
appropriate adoption flow is complete.

The Cambridge demo contains two verified sources, Principal and Manager offices,
Management and SMC bodies, five current appointments, two bounded mandates and five
decision routes. The fee-policy route is labelled institution-specific and requires
current Karnataka applicability review; it is not presented as a universal rule.

## Delivery sequence

| Slice | Outcome | State |
| --- | --- | --- |
| A1 | Authority sources, offices, bodies, seats, appointments, mandates and decision-map read model | Implemented locally; UI validation pending |
| A2 | Protected adoption of authority changes, appointment evidence, vacancy/expiry management and continuity | Next |
| A3 | One complete collective path: proposal versions, notice, eligibility, conflict, quorum, voting, resolution and certification | Planned |
| A4 | Bounded decision authorisation linked to one real domain command and idempotent execution | Planned |
| A5 | Implementation evidence, independent verification, obligations and oversight closure | Planned |
| A6 | College and coaching-specific templates, external conditions and additional supported procedures | Planned |

Advanced proxies, weighted voting, secret ballots and offline voting stay unsupported
until their complete procedure, privacy and evidence semantics exist.

## Invariants

- GOV-AUTH-001: every record has one institution owner; all relational references retain
  that owner.
- GOV-AUTH-002: a technical administrator or permission cannot create institutional
  authority.
- GOV-AUTH-003: an authority source retains issuer, jurisdiction, reference,
  verification state and effective dates.
- GOV-AUTH-004: an office or seat has at most one current/future appointment in this
  release; vacancies are visible.
- GOV-AUTH-005: an ex-officio seat references the qualifying office.
- GOV-AUTH-006: a mandate has exactly one holder type and can only narrow its source.
- GOV-AUTH-007: a standing decision route references a standing mandate.
- GOV-AUTH-008: a rule remains suggested until its applicable source and adoption route
  are confirmed.
- GOV-AUTH-009: a draft governance change cannot authorise its own adoption.
- GOV-AUTH-010: a collective decision requires its supported procedure; an approval count
  is not a resolution.
- GOV-AUTH-011: an adopted resolution and current executor authority are separate facts.
- GOV-AUTH-012: implementation, evidence submission and verified closure are separate
  states.

## Primary-source boundary

The framework was checked on 7 October 2026 against the official
[CBSE Affiliation Bye-Laws](https://www.cbse.gov.in/cbsenew/aff-bye-laws.html),
[Ministry clarification on the 2026 SMC Guidelines](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2263719&lang=1&reg=20),
[UGC autonomous-college regulations, 2023](https://www.ugc.gov.in/pdfnews/0367475_UGC-(Conferment-of-Autonomous-Status-upon-Colleges-and-Measures-for-Maintenance-of-Standards-in-Autonomous-Colleges)-Regulations,-2023.pdf),
[Ministry reply on coaching regulation](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2298513&lang=1&reg=1),
and the [Ministry reply on education fees](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2298339&lang=1&reg=48).
These sources support specific examples, not a universal legal template. Each institute
must retain its applicable State/UT, board, university, governing-document and effective-
date evidence.
