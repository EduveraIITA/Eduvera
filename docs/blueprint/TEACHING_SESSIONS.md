# Teaching a scheduled session

Implementation contract, 24 October 2026. Extends stories5–6 in
`END_TO_END_CAMPUS_WORKFLOWS.md`; delivery evidence remains in the implementation plan.

## Person and smallest useful experience

A current instructor opens one dated session from Today or Timetable. A compact
summary identifies its group, time, current place and teacher. The same page keeps
shared reading/code resources, previous recorded coverage, this session's actual
lesson record, and links into authoritative attendance and learning work. It does
not create a second register, assignment editor or schedule. Preparation, reported
teaching, attendance submission and assignment completion are distinct facts.

The existing activity foundation supports a teaching group without class/term
scaffolding. Academic classes retain their typed eligibility, subject and term.
Unsupported context-specific learning actions are unavailable with a reason; a
generic activity must never fabricate school enrollment merely to enable homework.

Related practice/assignments keep their existing publication, audience, private
questions, submission, reviewer and correction rules. Session access alone grants
none of those powers. A cover teacher must not read the original instructor's
private learner drafts, feedback or conversations.

## Native lesson ownership and authority

Learning owns append-only lesson-record revisions and immutable resource versions.
Each identifies the logical dated session and exact scheduling provenance. Academic
identity uses the existing school/class/date/period logical occurrence key, not a
revision-derived timetable occurrence ID. A room/cover change must not create a
second lesson history. Native activity versions retain their existing explicit
supersession/cancellation lineage; their past actuals are never moved to a new plan.

The explicit supported `learning.sessions.manage` action permits lesson resources
and records only in its appointed class/subject or institution scope and with a
matching scheduled teaching responsibility. It has no default/seeded grant.
Administrator status, attendance permission, participant membership or scheduling
a lead is not lesson-writing authority. Native activities additionally require
the named current lead. Original and accepted replacement teachers remain distinct;
current exact cover may operate only the accepted session under this capability,
not all class work. Revoked identity/authority fails closed on reads, writes,
downloads and retries. Original teachers with current relevant authority may read
the resulting session record after cover.

Resources explicitly shared with this session are visible only to currently
authorized instructors and its eligible participants. Staff-only preparation is
not disclosed to participants. Recorded topic/learner notes are shared, attributed
reports, not proof of physical teaching. A later correction requires a reason and
retains the original. Neither attendance nor opening the session auto-completes it.

## Existing owners and safe recovery

The attendance owner resolves its actual daily/session grain and exact register.
Show daily attendance as daily, not as evidence for an individual lesson. Date,
source and return context survive ordinary navigation. Scheduling owns room and
cover changes, conflict checks, acceptance and acknowledgements. Link to those
existing editors/responses; do not add another schedule writer or manufacture
acceptance. Completion is reported only from an actual recorded lesson outcome.

Every new material writer prepares its typed command before native effects, under
the selected-world identity, time, authority and source revision. Native record,
audit, safe event and correlated outcome commit together. Receipt lookup precedes
mutable stale-state validation after current authorization. Same-key changed
payloads conflict; uncertain results retain the exact command and inputs for
serialized retry; known acceptance with failed refresh permits read-only recovery.
Optional staff preparation, resource filenames/content and private learning work
must not enter generic Work/Core messages. No new reminder or routing defaults.

## Files, Simulation and acceptance

Use the current environment-bound artifact port with immutable ID/byte-length/hash,
safe bounded types and attachment-only downloads. A changed file is a new version,
not an overwritten URL. Snapshot metadata never authorizes a Live byte read in
Simulation; omitted bytes stay visibly omitted and branch uploads stay run-local.
Preserve existing records and apply additive reviewed migrations only.

Verify current/revoked and wrong-tenant/source access, student/private-field
separation, exact cover boundaries, room-change identity, stale/concurrent edits,
changed-payload and response-loss replay, correction history, file rejection and
storage failure, and actual COW mutations with unchanged Live/sibling state.
Use the same ordinary screens and semantic theme in all four appearances, with
compact aligned content, finite lists, visible focus and mobile safe-area actions.
Physical-phone approval, provider effects and any undelivered story details remain
explicit release gates, not implied by component tests.
