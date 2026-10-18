# Organization reporting structure

Implementation contract for the owner-approved organization hierarchy reference
(18 October 2026). This descriptive domain complements, not replaces,
`WORK_PROFILE_ACCESS_ARCHITECTURE.md` and
`INSTITUTE_GOVERNANCE_AUTHORITY_ARCHITECTURE.md`.

## Ownership and authority

- Organization owns named leadership, department, team and position nodes, their
  reporting parents, head references and member references. Staff Operations owns
  the linked staff records and person identities. No copied employee identity or
  separate work-type catalog is created.
- Reporting membership does **not** grant application capabilities, assign duties,
  appoint an officeholder, delegate institutional authority or establish consent.
  These remain with their existing owning domains.
- This first workspace is administrator-only, rechecked against current active
  institution membership for every read, command, retry and event delivery. It does
  not introduce an implicitly granted staff permission. Delegated/read-only staff
  access requires a separately reviewed scoped access contract.
- Schools start empty. The reference image's people, counts and reporting lines
  are not production seed data. Existing staff department text is not silently
  converted into authoritative reporting lines.

## Domain command and persistence

`GET/PUT /api/v1/schools/:schoolId/organization/` owns the workspace and save.
The client submits a full bounded draft with expected aggregate revision and UUID
request ID. Server validation rejects duplicate identities, missing parents,
cycles, more than 12 levels, more than 250 nodes and foreign-school staff.
New person links require active staff; existing inactive links remain visible for
explicit correction. Unassigned nodes and multiple top-level nodes are allowed.

Migration 135 creates canonical nodes and member links with composite school FKs,
an aggregate revision and retained snapshots. A school-scoped advisory lock,
row locks and membership/staff shared locks serialize writes and authorization.
Deletion in a draft never deletes staff; the UI explicitly promotes direct reports
to the removed node's parent. Historical structure snapshots remain retained.

Each accepted save uses `DomainCommandGatewayPort` before material effects,
`DomainEventJournalPort` for the accepted event, and a correlated command outcome,
all in the same database transaction as the structure revision and event outbox.
The live authority receipt cites current administrator membership. In Simulation,
the gateway uses its existing selected-environment authority evaluation and fails
closed without a matching `organization:manage` grant. It does not fall back to
Live or provision a grant implicitly. DatabaseService supplies the selected data
plane; the browser never selects a persistence namespace.

Exact retries return the retained revision after current authorization. Reusing a
request ID for a different payload conflicts. Optimistic conflicts preserve the
client draft; loading a newer revision requires explicit discard confirmation.
Outbox payloads contain revision/count invalidation metadata, not names or contact
details. Current administrator authority is rechecked for real-time delivery.

## Interaction

The existing shell is retained. Organization is discoverable under More → Institute.
Desktop offers a connected, scrollable/zoomable hierarchy and details sidebar;
mobile offers a collapsible outline and a native modal details sheet. List view,
search with ancestor paths, department filters, keyboard-operable parent selection,
head/member selection, local Undo and explicit Save use one authoritative editor.
Moving a desktop card and changing “Reports to” produce the same draft change.
Native modal focus containment, labelled controls, live save/error status, unknown
response retries and app-back/link/unload draft warnings are included. A newer
server snapshot is surfaced without overwriting an in-progress draft.

## Release validation boundary

Focused domain/UI tests, production compilation, responsive browser fixtures and
isolated PostgreSQL-compatible migration checks are local implementation evidence.
The real PostgreSQL/model-gateway integration suite is included and requires the
existing disposable CI database. It must pass before release; fixture-rendered
screenshots are not proof of a live API deployment. No deployment is recorded by
this implementation checkpoint.
