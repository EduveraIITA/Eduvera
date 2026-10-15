# Institution and campus replica model

Status: accepted campus-topology domain model, 16 October 2026
Blueprint basis: [ThatCampus product blueprint v2](PRODUCT_BLUEPRINT_V2.md) and
[Campus digital twin and agency architecture](CAMPUS_DIGITAL_TWIN_AND_AGENCY_ARCHITECTURE.md).
User decision: institute setup should feel like constructing a digital replica of the physical campus, from one teacher and one learner to a multi-branch institution.

This document owns the campus-topology domain projection. It does not define the
Campus Model Core and its tables are not a shortcut around the model-core API. The
topology domain keeps authoritative campus, space, resource and placement rules;
stable cross-domain identity and relationships are registered through model-core
ports in the same application transaction.

## Product boundary

Institute setup answers four questions without mixing them:

1. **What institution is this?** The existing `schools` record remains the tenant and legal/operating institution anchor.
2. **Where does it operate?** Campuses/branches and their physical or virtual spaces form a navigable hierarchy.
3. **What belongs where?** Academic groups, staff and bounded operational resources receive dated placements.
4. **Who may configure or operate it?** Institution administrators configure the tenant. Principal and other operational authority comes only from explicit role/work assignments, not from administrator membership.

The model deliberately does not become a property-management, depreciation, procurement, maintenance-ticket or general inventory product. It records only the resources and locations needed for campus operations, scheduling, safety and capacity decisions.

## Core model

### Institution

`schools` remains the tenancy anchor. One-person tutoring and a multi-branch school use the same model; the smaller institution simply has one primary campus, few spaces and optional resource holdings.

### Campus

`institution_campuses` represents a physical branch, learning centre or virtual campus. A nullable `parent_campus_id` supports a regional or parent/child branch structure without requiring it for ordinary schools. Important fields remain relational: type, lifecycle status, primary-campus flag, address and timezone.

Rules:

- every institution has exactly one primary campus;
- a primary campus cannot be inactivated until another primary campus is selected;
- parent campuses belong to the same institution and cycles are rejected;
- inactivation is rejected while the campus owns current class/staff placements or active resource holdings;
- creation of an institution backfills one primary campus automatically.

### Space hierarchy

`campus_spaces` is an adjacency-list tree scoped to one campus. Supported types cover the bounded operational needs: building, wing, floor, classroom, laboratory, library, office, auditorium, sports area, workshop, staff room, gate, outdoor area and other.

Relational attributes include capacity, accessibility, bookability and lifecycle status. `attributes` is reserved for non-authoritative extension metadata; authorization, capacity and identity never depend on an opaque JSON field.

Rules:

- a parent must be in the same institution and campus;
- a space cannot parent itself or one of its descendants;
- spaces with live child spaces, placements, timetable bookings or resource holdings cannot be silently removed;
- space codes are unique within a campus;
- historical room text is migrated into classroom spaces and preserved as a display snapshot.

### Resource types and holdings

`campus_resource_types` describes reusable institution-defined kinds such as Computer, Projector and Chemistry lab equipment. `tracking_mode` is either:

- `pooled`: a quantity at a location, such as 30 computers in Lab 2;
- `individual`: one identified unit, such as a school bus or tagged projector.

`campus_resource_holdings` places that type at a campus and optionally a space. Individual holdings may carry an asset tag and always have quantity one; pooled holdings carry quantity. State is deliberately bounded to available, unavailable or retired. Maintenance workflows and financial asset accounting remain outside this module.

### Effective-dated placements

`class_campus_placements` assigns an academic class/cohort to a campus and optional home space for an effective period. `staff_campus_assignments` does the same for staff and supports more than one concurrent campus while allowing only one current primary campus.

Placements preserve history. A move closes the prior row and creates a new row in one transaction. They do not change academic identity, enrollment history, staff role, permissions or responsibility assignments.

Rules:

- the selected home space belongs to the selected campus;
- overlapping primary placements for the same class or staff member are rejected;
- a placement cannot begin after it ends;
- class placement normally follows academic-year boundaries, but an administrator may use another reviewed effective date;
- students inherit their ordinary campus context from current enrollment and class placement; explicit student location records are not duplicated.

### Scheduling integration

Published timetable slots, versioned schedule periods and dated day-plan periods may reference `space_id`. Their existing `room` text remains a display/audit snapshot for old records and external exports. New editors choose an actual space, and the service writes its current name/code snapshot.

Conflict checks can therefore evolve from comparing free text to comparing stable space identity. This slice adds the durable relationship; full capacity and collision acceptance remains timetable scope.

## Administrator and Principal separation

An institution creator receives an active `admin` membership. That membership controls configuration, account access, institution setup, operating rules and activation. It does not itself mean the person is Principal.

Principal is an operational position/role assigned through the existing role/work architecture with explicit scope and dates. During compatibility migration, existing administrator routes may retain their `/principal` technical path, but visible identity, home routing and future authorization must treat administrator and Principal as different concepts. Removing the legacy implicit operational bypass is a staged access migration because multiple established services currently use administrator membership as their authorization boundary; it must not be represented as complete until those services use explicit assignments.

## Setup experience

The administrator sees one connected campus, not a catalogue of unrelated forms:

1. Institution and campuses.
2. Buildings and spaces inside the selected campus.
3. Classes and staff placed into that campus.
4. Bounded equipment/resources placed into spaces.
5. Academic structure, people/roles, account access and operating rules linked as connected configuration domains.

The overview uses computed readiness rather than self-declared completion. Required checks are capability-pack aware. A small coaching institution may be ready with one campus and no tracked equipment; a multi-campus school must resolve unplaced active classes and staff. Optional resources never block activation merely because the catalogue is empty.

## Transaction, audit and concurrency rules

- every command verifies active institution-administrator membership inside the transaction;
- every mutable aggregate uses a revision and rejects stale writes;
- cross-tenant campus, parent, space, resource, class and staff relationships are prevented by composite foreign keys and service checks;
- effective-dated moves lock the current placement before closing it;
- mutations write an append-only setup audit and scoped event-outbox fact in the same transaction;
- public-demo sessions remain read-only under the existing guard;
- browser/database roles receive no direct table grants.

## Migration and compatibility

1. Create a primary campus for every existing institution.
2. Convert distinct non-empty class `room_number` values into classroom spaces.
3. Create current class placements using the relevant classroom when one exists.
4. Create current primary staff-campus assignments using the staff joined date.
5. Add nullable space references to timetable records; preserve all room snapshots.
6. Seed common resource types without creating fake holdings or quantities.

No existing class, staff, timetable, attendance, enrollment or room history is deleted. No equipment is inferred from text or demo assumptions.

## Deferred acceptance

- explicit Principal assignment and removal of every legacy administrator operational bypass;
- timetable capacity/collision validation using `space_id`;
- campus-scoped emergency/gate behavior and device binding;
- bulk campus/space import;
- physical mobile validation with a real multi-building and multi-branch administrator;
- any facilities-maintenance or financial asset-accounting capability.
