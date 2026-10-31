# Campus Calendar: important dates and changes

Owner decision, 28 October 2026: retain Calendar as a distinct Area only when it
answers a different question from Timetable. This applies across educational
campuses, including schools, colleges, training providers and mixed institutions.

## Purpose and boundaries

Calendar answers: **What important dates, deadlines or changes should I plan for?**
Timetable answers: **What session or duty is happening, when and where?**
Work continues to own required decisions and actionable queues. Calendar does not
become a second Work inbox, timetable, attendance register or domain editor.

Calendar is a read-only composition of source-owned facts. Original identifiers,
published titles, dates, locations, cancellations and revisions are preserved.
Details link to the independently authorized owning feature. All mutations retain
that feature's existing DT commands, accountability and selected-world boundary.
The annual-fixture request below adds a narrow native publisher for informational
important dates; it is not a generic writer for other domains or another planner.

## Research and interaction decision

The owner's repeated screenshots show routine duties/classes duplicated in Calendar
and confusing date/view controls. They are direct evidence for separating purpose
and using the existing shared control, not grounds to redesign the entire shell.

Primary references:

- [Google Calendar view/date navigation](https://support.google.com/calendar/answer/6110849?hl=en&co=GENIE.Platform%3DDesktop):
  date arrows, Today and selecting a date are distinct from choosing a view.
- [Stanford Events: finding events](https://events-help.stanford.edu/event-seeker/find-events):
  chronological results, date ranges, search and optional contextual filters.
- [Stanford event taxonomies](https://sitesuserguide.stanford.edu/build/event-content-type/event-taxonomies):
  distinguish event type, audience and subject without embedding one institution's
  categories into a universal calendar.
- [Outlook categories and reminders](https://support.microsoft.com/en-us/outlook/training/use-calendar-categories-and-reminders-in-outlook):
  category labels help distinguish dated information without creating separate
  calendars for each task.

Design inference from these patterns: one familiar month overview with selected-day
details, a List alternative, date controls together, and optional type/search tools.
This is not a vendor-endorsed clone or a claim of measured user preference.

## Current read experience

- Default Month: complete selected-month source reads, dated markers and the
  selected day's facts below. Month/year opens the shared native date control;
  arrows change the month; Today appears only when needed.
- List: the complete selected month's facts, including earlier dates and ranges
  carried over from the previous month. Previous/next changes the month in both
  views. Direct date selection and Today remain available; no unbounded feed.
- Search presents matches across the whole loaded month, not only the selected
  day; selected date, view and exact person context are retained. Date type offers only sources available
  in the exact current context. Closing Search clears it and restores focus.
- Eight entries per page; date, view, filter, query, page and exact person context
  survive source details. Dated source details are read-only.
- Source failures/partial pages are explicit. A failed or revoked source cannot
  leave stale rows visible or imply that the month is empty. Markers describe
  loaded facts, not a completeness assertion while sources are incomplete.

Month uses the shared Monday-first display convention, not an institutional
working-week rule. No semester, course, institution type, learner age, title-based
portal, compulsory festival category, weekend closure or term template is assumed.
Institution-owned labels and dates remain authoritative; no new setup wizard is
required to read existing published facts.

## Implemented sources and honest limits

| Source | Included now | Bounds and authority |
| --- | --- | --- |
| Published important dates | Date-only informational milestones/windows, including historical plans, current corrections and cancellation reasons | Native Campus Dates owner; all current institution members read; institution-scoped `calendar.manage` plus current acting human identity to publish/correct/cancel; finite selected-month overlap reads |
| Published campus calendar days | Holidays, non-instructional dates and explicit dated overrides, retaining source meaning | Existing member-authorized days API; selected month; a non-instructional day is not automatically a campus closure |
| Campus events | Published, completed and cancelled events | Independent Events manifest contribution plus owning API; campus-timezone ISO overlap range; bounded cursor pagination; partial coverage labelled |
| Assessments | Owner-returned dated assessment entries | Independent Assessments contribution; exact learner/family relationship retained; no invented duration; existing API omits cancelled assessments and selects by start date, not overnight overlap |
| Service changes | Explicit dated Dining exceptions, cancellation and pause | Availability contribution and existing date-range API; bounded pagination; routine meal hours and menus excluded |

Routine classes, duties, attendance observations, private leave explanations and
unpublished event drafts are deliberately excluded. Source unavailable does not
mean no dates. A repair estimate is not an authoritative building-closure notice.

The full important-dates goal still needs these **owning-domain feeds**, not
frontend guesses:

1. Personal payment deadlines using current charge/installment state, exact audience,
   effective dates, cancelled/replaced obligations and cursor completeness.
2. Assignment submission deadlines with complete date-range access and individual/
   group ownership; filtering the first ten assignment rows is not sufficient.
3. Member-visible term/period boundaries when a campus uses them; a management-only
   term catalogue must not be borrowed as general member authority.
4. Authoritative registration/admission windows and facilities-access changes when
   their owning workflows exist. Do not manufacture them from draft configuration,
   private repair cases or unsupported date fields.

Each additional adapter must retain source identity/revision, audience, timezone,
range/completeness, cancellation/replacement meaning, exact source link and
Live/Simulation parity. Existing work queues and alerts are not duplicated.

## Authority and verification

### Annual-fixture correction — 28 October 2026

The owner requested a coherent July 2026–June 2027 Aaranya fixture and explicitly
authorized related campus-data changes where needed. Review found that existing
calendar overrides suppress teaching and Events requires future enrolled
participants. Neither is a valid store for neutral registration/term/result
information. The new `CampusDatesModule` owns precisely that informational source.

Published dates have inclusive local dates, title/description, an optional category
label and an optional same-institution academic-term reference. They are explicitly
member-public, never a private assessment, personnel or financial projection.
Creating one neither activates a period/enrollment nor records a class, booking,
instructional closure, payment, result, participation or physical event. Existing
owners retain all of those commands. General published information must not be
presented as a confirmed individual deadline from an unconnected owning workflow.

Publication, correction and cancellation use current institution-level
`calendar.manage` and a current human account endpoint, exact idempotency/revision
checks, accepted Core command/event/outcome evidence and immutable native revision
history. The capability is assignable at institution scope only and is excluded
from default staff access. Calendar offers one compact native date form only when
the source says `can_manage`; all other source details retain their original edits.
Correction reasons and cancellation remain visible; uncertain writes retain their
exact request/key, while a saved-but-unrefreshed view never suggests publishing again.

Historical informational plans may be entered with today's recorded provenance;
that does not backdate operating evidence or bypass the closure/event past-date
guards. The fixture importer validates actual term dates/activation, current
programmes and the existing November break, resolves term IDs and refuses to
overwrite customized publications. Related Events, Assessments and Dining examples
use their own existing canonical people/cohort/place and native writer contracts.

Public-date events invalidate only Calendar caches through the existing authorized
selected-world stream, without inbox Tasks or notification records. The source and
recipient validators require exact accepted native evidence and current membership.
Both native date tables are captured by ordinary school-scoped snapshot/COW rules;
no Live lookup or separate Simulation calendar implementation is permitted.

Delivered on release198/schema277: 56 dates for July2026–June2027, including 19
date records linked to the two retained academic periods. Native normal authoring
and immediate repeat passed with no duplicates or academic-structure changes.
Four connected Events, two Assessments, six Dining weeks and three dated Dining
changes use their existing owners. Actual four-account browser review and normal
API acceptance are in `artifacts/aaranya-calendar-year-20261028/`; the testing
guide gives concrete November, January and March journeys. Search styling and
detail padding were corrected from rendered evidence at320/390/768px. Physical
keyboard, screen-reader and rendered Calendar amber acceptance remain unclaimed.

All supported contexts use `CampusDatesCalendar`, selected by current server
contributions rather than member role or job title. Assigned/manage contributions
are not two user-visible calendars. Linked family members never silently switch
learners. Timetable/Events/Assessments links each need their own exact contribution;
Calendar access alone grants none of them.

Queries partition actor, institution, person/surface, timezone, range and selected
world. Unavailable Simulation cannot read Live. Calendar changes are acknowledged
only against the exact source revision referenced by the incoming update.

Focused tests, read-only browser evidence and delivery limits are recorded in
`IMPLEMENTATION_PLAN.md`, root [Verification](../VERIFICATION.md#ui) and
`artifacts/calendar-purpose-20261028/`. A passing implementation review is not owner
visual acceptance, actual Dark/amber visual proof or a compiled-runtime activation.
