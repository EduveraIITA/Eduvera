# Responsibility-composed application

Status: accepted target product and interaction contract, 18 October 2026

Normative parents:

- [ThatCampus product blueprint v2](PRODUCT_BLUEPRINT_V2.md)
- [ThatCampus operating experience](THATCAMPUS_OPERATING_EXPERIENCE.md)

Technical companions:

- [Universal institution model](UNIVERSAL_INSTITUTION_MODEL.md)
- [Roles and contextual assignments](WORK_PROFILE_ACCESS_ARCHITECTURE.md)
- [Organization reporting structure](ORGANIZATION_STRUCTURE_ARCHITECTURE.md)

## 1. Decision

ThatCampus has one application, one stable shell and one set of domain workspaces. It
does not ask an operator to choose a Teacher, Principal, Gatekeeper or Administrator
portal. It composes the person's experience from their effective responsibilities.

For an authenticated person, the server resolves:

```text
identity
+ effective responsibilities and scopes
+ current authority
+ enabled and ready capabilities
+ owned work
+ current time and applicable place
+ selected Live or Simulation environment
= personal workspace
```

The result changes the records, actions and areas the person may see; it does not
create a different product shell. A job title is descriptive. A role may be a reusable
administrator convenience for assigning a bundle of responsibilities, but it is not a
portal, an agent class or implicit authority.

Administrator and Principal are distinct responsibilities. Creating an institution or
holding administrator membership never silently grants teaching, Principal or daily
operations responsibility. One person may hold both through separate effective
assignments, and the application may show their combined work without merging the
authority evidence used by each command.

## 2. Start from the operating experience

Before extending a schema, API, projection or Model Core primitive, define:

1. the concrete person and responsibility;
2. the situation, time, place and desired outcome;
3. what the person must understand on first view;
4. the shortest successful mobile journey;
5. empty, unavailable, expired, conflicted and revoked states;
6. correction, delegation, cover and hand-off;
7. what remains visible after completion.

Only then derive the minimum responsibility, authority, domain and coordination
contracts required to make that experience truthful. A generic screen generator,
generic object browser or infrastructure primitive must not dictate the person's
mental model.

## 3. Stable shell

The primary authenticated shell has four stable purposes:

| Destination | Purpose | Content rule |
| --- | --- | --- |
| **Today** | What is happening now and next | current context, genuine attention and near-term plan; never a second editor |
| **Work** | What I or my team must resolve | requests, tasks and offers with authoritative domain links |
| **Areas** | Where I can operate | enabled domain workspaces for which the person has a current relationship or authorized responsibility |
| **More** | Lower-frequency personal and administrative tools | search, history, appearance, connections, setup and governance where authorized |

**ThatCampus AI is a persistent cross-application action, not a fifth information-
architecture destination.** When enabled and authorized it remains reachable from
the shared shell on every supported mobile experience and may expand into the
canonical `/areas/assistant/conversation` surface. Moving to the composed shell must
not make the assistant, notifications, relationship/scope selection or descendant
attention less available than they were previously.

These positions do not reorder when work arrives or an assignment changes. Empty
destinations explain the next useful action without presenting irrelevant setup. A
child, guardian or other relationship-scoped participant uses the same purposes with
content and domain language appropriate to that relationship.

The header identifies the institution and relevant current scope and exposes notifications
and account access without a floating environment marker covering those controls. It does
not expose a role picker. Live uses the established blue application palette; Simulation
uses the reviewed warm amber application palette. A campus/scope selector is shown only when the person can operate more
than one legitimate scope and the selected scope materially changes the records being
viewed.

Live and Simulation render the same shell, routes and domain components. Environment
selection is server-authoritative and application-wide. Simulation changes the complete
theme, virtual time and backing isolated data; it does not add a fifth destination, a parallel
dashboard or a simulation-only version of a domain.

## 4. Responsibility contract

An executable responsibility records or resolves:

- responsible human or team;
- supported capability/actions;
- institution and bounded operational scope;
- effective start/end and, where necessary, duty schedule or trigger;
- current authority source and any procedural domain constraints;
- accountable owner and configured fallback;
- delegation, accepted cover or revocation where applicable;
- source assignment, revision and audit provenance.

Scopes may refer to an institution, organizational unit, campus, space, programme,
cohort/class, session, resource, case or other registered domain context. New scope
kinds extend the registered contract; they must not require a new portal or hard-coded
job-title branch.

Responsibilities are additive only within their own scopes and authority. Seeing one
domain does not grant actions in another. Visibility is a useful projection, never the
authorization boundary; every command rechecks the current assignment, authority,
domain state and environment.

Temporary duty and cover are responsibilities with bounded time and provenance, not
account mutations. Revocation removes current visibility and action immediately while
retaining legitimate historical records.

## 5. Domain workspace contributions

Each enabled domain contributes a small versioned application contract rather than a
parallel navigation system:

- capability/action key and plain campus label;
- eligibility from current responsibility/relationship and readiness;
- neutral canonical route;
- Today summary and next relevant plan, if any;
- owned-work query and exact authoritative deep links;
- domain workspace entry point;
- current authority requirements;
- loading, empty, unavailable, unauthorized and environment-support state;
- attention aggregation and correction route.

The server composes these contributions into the personal workspace. Domains retain
their authoritative state machines, records, commands, evidence, history and
correction paths. Their presentation is not frozen: Attendance, Timetable, In & Out,
Examinations, Messages and every other domain must evolve into the same composed
shell, context and responsibility language. A canonical workspace is not an old
persona page mounted at a neutral URL, and the composition layer neither grants
access nor becomes a generic domain editor.

Canonical application routes describe work rather than personas, for example:

```text
/today
/work
/areas
/areas/attendance/...
/areas/timetable/...
/areas/in-out/...
/more/...
```

Persona-prefixed route trees and menus are not the target architecture. During a
bounded migration, an old bookmarked URL may perform a tested one-way redirect to its
neutral canonical route, but it cannot select a portal, contain business logic, appear
in navigation, restore legacy authority or be retained as an indefinite compatibility
configuration.

Owner clarification, 20 October 2026: **Calendar is its own Area**, with canonical
route `/areas/calendar`, not a nested Timetable tab. Its existing authorized
schedule responsibilities and self/dependent relationships are projected into a
distinct Calendar contribution using the same capability and scope evidence; the
navigation move grants no new authority and creates no parallel editor. Calendar
returns to Areas and may link to the exact authorized Timetable context; Timetable
may link to Calendar. Retained `/areas/timetable/calendar` bookmarks redirect to
the canonical route without dropping child, date, view, attention revision or hash.
Several linked relationship calendars require an explicit choice rather than an
arbitrary child default. Both Areas use the selected Live/Simulation environment.
Non-relationship calendars use the same authorized activity-occurrence read API as
Timetable, not Teacher/Principal home APIs or a second schedule engine. The month
selector must not imply complete activity presence/absence from one capped page;
when a full authorized month summary is unavailable, show neutral dates and bounded
selected-date results with explicit pagination. Campus-date attention remains tied
to its exact authorized source record/revision. Existing academic self/dependent
calendar adapters retain their relationship authority and capabilities.

### 5.1 Capability-preserving migration

The new organization may change where a capability is found; it must not reduce what
the product can do. Existing actions, records, rules, history and correction paths
remain product requirements unless the owner explicitly retires one. Existing pages
are the parity baseline, not the target architecture: each domain experience must
evolve into a responsibility- and relationship-scoped canonical workspace with the
shared context, language and environment contract. A route, tile, component or persona
menu may be removed only after its complete capability has converged there.

For every existing capability, keep a version-controlled migration inventory that
records:

1. its current user journeys and authoritative domain screen;
2. the responsibility or relationship that makes it eligible;
3. its canonical Area, Work, Today or More entry and neutral route;
4. parity for read, create, update, review, correction and history actions;
5. preservation of child/class/campus scope, filters and safe return state;
6. equivalent loading, empty, denied, revoked, Live and Simulation behaviour;
7. discoverability from navigation, search, attention and relevant deep links;
8. focused tests proving the canonical path before an old bookmark becomes a redirect.

Capability preservation protects what a person can understand and accomplish, not
the legacy information architecture or component tree. A migration is incomplete if
the canonical route merely selects a Teacher, Principal, Parent or Student page behind
the scenes, retains its persona navigation, or makes a user choose which version of
the product to enter.

A component rendering at a new URL is not by itself convergence or parity. A redirect is unsafe if
the destination omits an action, loses query scope, changes authority, hides a feature
from normal discovery or silently falls back to another environment. Until parity is
proved, the existing route remains functional as a bounded compatibility entry to the
same domain screen. It must not become a parallel source of truth or a second editor.
That compatibility entry is temporary risk control, not a decision to preserve the
old screen design or portal architecture.

## 6. First proof: Kavita's connected working day

Kavita Mehta is one person with one account and stable human-agent identity. On the
same date she has three separately authorized responsibilities:

1. teach Mathematics to Class 6A from 9:00–9:45 in Classroom 201;
2. maintain Lab 2 and resolve its assigned readiness tasks;
3. cover Main Gate from 2:00–4:00 as an accepted temporary duty.

### Before the first lesson

Kavita opens **Today**. The 9:00 lesson is Now or Next and opens the existing timetable
or attendance workspace. Lab readiness appears in **Work** only if an unresolved task
is genuinely owned by her. The future gate duty is shown as planned context, not an
urgent badge.

**Areas** contains the authorized Attendance, Timetable, Lab and In & Out entries.
This does not imply equal authority: each entry and every action is scoped to the
corresponding assignment.

### During the lesson

Today makes the Class 6A register the primary action. Submitting attendance uses the
authoritative Attendance workflow and produces the accepted result, event and next
work through the existing domain/Core path. Today updates; it does not maintain a
second register.

### At 2:00 PM

The accepted gate duty becomes current. Today prioritizes Main Gate, and In & Out uses
the existing gate workspace. Kavita's teaching and lab history remain available, but
the shell does not ask her to switch to a Gatekeeper portal.

### Change and correction

- If gate cover is revoked before 2:00, the current gate action and authority disappear
  after reconciliation; the retained assignment history explains the change.
- If Kavita accepts class cover, that bounded responsibility appears at the relevant
  time without changing her account type.
- If Lab 2 is unavailable, the owning domain records the state and routes configured
  work; the composition layer does not invent a repair workflow.
- If an administrator also grants Kavita a configuration responsibility, setup appears
  under More while Principal decisions remain absent unless assigned separately.
- In Simulation, this exact journey uses the same screens against run-local state and
  virtual time. Returning to Live restores unchanged Live work and caches.

## 7. First implementation slice

The first vertical slice proves the complete journey rather than creating a new shell
with placeholder cards:

1. define the versioned responsibility and domain-contribution projection contracts;
2. produce one server-authoritative personal-workspace response;
3. implement the stable Today / Work / Areas / More shell and neutral routes;
4. adapt Attendance, Timetable and In & Out as the first real contributions;
5. use existing assignments and accepted temporary cover/duty where valid;
6. add only the missing generalized scope/assignment support required by the proof;
7. evolve domain editors into the composed experience while preserving their command
   gateways, evidence, correction history and complete useful action set;
8. verify Live and Simulation resolve the same contribution contracts without data
   mixing.

The slice is accepted only when Kavita's combined journey works from one account on a
supported mobile viewport and every visible action is independently authorized.

## 8. Legacy-removal gates

There is no user-facing experiment toggle, portal chooser or permanent dual
architecture. Migration is complete only when:

1. account category no longer maps `staff` to Teacher or `admin` to Principal;
2. shared navigation is not selected from hard-coded persona menu arrays;
3. Today, Work, Areas and More come from the responsibility-composed contract;
4. Attendance, Timetable and In & Out use neutral canonical routes and one
   authoritative domain action path;
5. attention, operating-day links and notifications no longer encode a Teacher or
   Principal portal destination;
6. administrator membership does not imply Principal, teaching or gate responsibility;
7. job title, organization reporting membership and descriptive position grant no
   application authority;
8. legacy timetable/title fallbacks cannot resurrect ended assignments;
9. old work-type/eligibility/configuration paths are removed after data migration and
   verified unused, not left selectable beside the new model;
10. old persona URLs, if temporarily redirected for bookmarks, contain no business
    logic or authority and are deleted after the bounded compatibility window;
11. no supported journey can reach both a legacy and a new editor for the same action;
12. focused authorization, revocation, mobile, deep-link, Live/Simulation and domain
    regression tests pass before the old path is removed.
13. a complete feature-parity inventory proves that every previously supported
    domain journey has an equal or better canonical home; no feature is removed merely
    because its old menu or route was persona-prefixed;
14. ThatCampus AI, notifications, relationship/scope context and descendant attention
    remain available through the shared shell wherever they were previously supported;
15. the composed surfaces retain the established ThatCampus design system and domain-
    specific interaction quality; migration is not permission to replace proven
    screens with generic lists or generic workflow cards.

Historical implementation-plan records remain historical evidence. They are not
current product permission to retain a legacy portal, fallback or parallel workflow.

## 9. Non-goals

- inferring responsibilities from job titles;
- making every person configure a custom role before first value;
- a generic form, dashboard or workflow builder;
- one giant hierarchy combining organization, place, academics and resources;
- replacing domain APIs with a workspace API;
- client-side authorization based on visible destinations;
- a new portal for every campus job title;
- retaining old and new experiences behind a feature switch;
- freezing old domain pages instead of evolving them into the composed experience;
- visually standardizing domain workspaces in ways that erase useful domain actions.

## 10. Working product test

The contract succeeds when Kavita can say:

> “I open one ThatCampus app. It shows what I am responsible for now, the work I need
> to resolve and the areas I can use. When my responsibility changes, the app changes
> with it; I never choose a job-title portal or wonder which copy of the work is real.”
