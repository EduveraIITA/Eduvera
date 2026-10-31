# Whole-campus guided setup

Status: accepted owner direction, 26 October 2026. Delivery evidence belongs in
`IMPLEMENTATION_PLAN.md`; this contract is not a claim that every future campus
workflow or import has shipped.

## Experience and scope

The person setting up a campus may begin with **I want to set up my whole campus**
in the existing purpose-first signup journey. Secure account creation and email
verification remain unchanged. This is a guided starting point into the same
institution, people, places and domain owners, not a separate product or portal.

Nothing requires all campus information upfront. A person can leave, return,
change the order or start a useful operation before modelling the whole site.
The guide has four small milestones:

1. Find or name the campus, reusing an existing active campus when present.
2. Make a recognisable layout from an allowed map, image/site plan, GeoJSON or
   manual drawing. Start with a boundary, entrance and a few useful buildings.
3. Review useful illustrated places together. Create the approved set or connect
   exact existing campus records in one action; configure individual details later.
   The shared native place form remains available for adding one missing place.
4. Try a familiar route and review/share through the existing scene editor.
   Then choose a useful activity such as entry, scheduling or maintenance.

Each stage explains one next action. Detailed fields and suggestions are optional
disclosures. No universal completion score, full roster, academic catalogue,
organisation verification, asset inventory or mandatory room survey blocks entry.

## Gradual completeness at the point of use

Detailed campus data is gathered where it helps a real decision. A building may
offer its floors and rooms; a route may suggest an entrance or connector; a repair
may need equipment or an accountable handler. People, responsibilities, learning
groups and bulk imports remain with their existing domain owners. Reuse previous
records and source files before asking someone to type the same information again.

The guide exposes optional paths to these owners. Suggestions are derived from
current saved records and the current scene revision, can be revisited, and do not
pretend optional illustrations are missing institutional data. More complete
surveys/imports may be offered later in context; do not invent unsupported import
formats or automatically infer authority, attendance, access, occupancy or consent.

## Truthful progress and corrections

Layout publication, available directions and operational readiness are separate
claims. The guide derives advisory gaps from current geometry, explicit route
endpoints and active canonical spaces using the existing walking solver. It has no
parallel route engine, checklist database or local completed-stage flags.

Decorative trees, rivers and other scenery need no DT connection. An image/model
proposal is reviewed input: it does not create canonical records or publish by
itself. The reviewed bulk action saves the linked draft atomically with its native
place changes. It does not approve geometry or publish. Cancel, unknown network
outcomes and revision conflicts retain a visible correction/retry path through the
owning service.

## Reviewed campus-wide place proposals

Owner clarification, 27 October 2026: an imported layout must not require a person
to select and create every place separately. The same editor offers a compact
review of the full proposed set, with editable names and types, generated unique
codes, and explicit Create new, Use existing, Same place or Keep visual choices.
No preliminary Save, per-row confirmation checkbox, full room survey or geometry
approval blocks this review. Trees, roads and planting remain illustrations;
useful outdoor surfaces can be explicitly included as places.

Outlines from one source feature may be proposed together using a document-local
`source_feature_id`. This is grouping provenance, never a canonical identity or a
cross-import match. Repeated names, external feature IDs and nearby geometry do
not merge records. People can correct the proposed grouping. Reusing an existing
place does not rename it or change its type.

One explicit action submits the exact current document and approved rows to the
native place and scene owners in a single selected-world transaction. Current
authority, campus, scene revision, reused-place and parent revisions are rechecked.
An invalid final row or failed native command leaves no partial places or links.
The retained idempotent receipt binds the exact request and resolved mappings;
retrying an accepted request must not overwrite a later draft revision.

Capacity, accessibility, booking policy, floors, equipment, people and operational
authority are not inferred from the picture. Source geometry review states remain
unchanged. Detailed configuration and the existing explicit publication step come
after the linked draft has been accepted.

## Continuation, authority and selected world

Only the intent `guidance: whole_campus` is retained on the existing progressive
workspace. Guidance-only entry does not force a capability selection. Legacy
explicit whole-campus goal expansion may recommend gate, timetable and facilities;
it never enables all capabilities, permissions or automatic operating rules.

The backend may contribute a fixed, rechecked guide continuation for the current
workspace owner with active full-campus administrative authority. Accepted exact
Assignment or Timetable source continuations take precedence. No arbitrary return
URL or stale institution preference selects another campus.

Account provisioning/preferences remain Live control-plane functions and reject
Simulation writes. Once in the guide, reads and native campus/scene commands use
the selected world. The amber guide never fetches Live onboarding preferences or
falls back to Live records. Canonical place creation, scene links, draft saves and
publication use the same owners, authority, revisions, idempotency and Model Core
evidence in Live and Simulation. Snapshot guidance is historical context only.

## Acceptance gates

### Navigation-only venue onboarding target

The owner's30October direction adds a planned **Help people find their way**
starting outcome for a mall, campus or other facility. It reuses the same guide,
canonical places and reviewed publication flow; no educational catalogue or
operating-domain setup is required merely for navigation. The detailed target and
provider gate belong to [Campus scenes](CAMPUS_VISUAL_SCENES.md#phone-only-facility-navigation-target-and-provider-gate).

The proposed continuation is venue → guided phone capture/optional existing plans
→ connected routes/destinations → supported worker self-survey → independent test
walk → chosen-audience publication. Ordinary workers may act alone or collaborate;
mandatory professional plans, a technician or special survey hardware do not meet
the refined target. The [research brief](CAMPUS_VISUAL_SCENES.md#research-problem-and-completion-goal)
defines the unproven sub-metre outcome and independent acceptance evidence.
Staff may use a phone camera for the setup survey; visitor navigation remains
camera-free, with no installed positioning hardware or physical location markers.
Each stage saves/resumes in the current venue and names the next concrete action.
Only uncertain proposals require operator correction; reusable data and bulk review
come before repeated per-room forms. Map publication, usable directions and tested
live positioning remain separate derived readiness claims. A partial venue can
publish accepted connected coverage without pretending every floor is ready.
This is planning, not an implemented new goal, survey screen or public map mode.

### Current guide acceptance

Verify guidance-only entry and safe retry, exact source continuation preservation,
current-campus/actor/authority checks, optional detail paths, draft versus published
truth, shared form cancellation/unknown outcome, reviewed publication and common
mobile/Light/Dark/amber UI. Exercise a meaningful branch place-to-scene mutation,
show unchanged Live and sibling state, and retain existing account security and
Simulation conformance gates.
