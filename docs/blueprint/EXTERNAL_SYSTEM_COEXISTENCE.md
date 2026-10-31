# External-system coexistence

Status: the owner explicitly requires partial adoption and the ability to connect
existing providers or replace them, 24 October 2026. The ownership boundary below
records that decision. Bounded Dining native/reference ownership and reference
views are implemented in source; general connector provisioning, synchronisation
and replacement/cutover procedures remain proposals. This is not a delivered
integration catalogue. Follow the Model Core, Operating rules, People and
Simulation contracts; final Dining acceptance belongs to its
[QA record](../VERIFICATION.md#dining).

## Adoption is per capability, not per campus

A campus can run one workflow in ThatCampus while keeping a canteen provider's app,
a payment ERP, a library system or another existing service. Neither a full-campus
migration nor central control over every operator is a prerequisite.

For each supported capability and scope, offer three honest modes:

| Mode | Authoritative action path | What ThatCampus can claim |
| --- | --- | --- |
| Operate here | The owning ThatCampus domain accepts commands and owns its records. | Native status and evidence, subject to the normal authority and correction rules. |
| Connected provider | A reviewed adapter addresses the external owner; reads and supported commands are explicitly declared. | Source-qualified, time-stamped provider state and confirmed outcomes; pending requests remain pending. |
| Reference / assisted | Deep link, reviewed file import/export or an accountable person's report; no transactional connector is assumed. | The reported/imported state, its source and freshness. Never “live sync” or automatic completion. |

Capabilities are narrower than modules: menu publication, orders, meal entitlement,
serving records, invoice issuance and payment reconciliation can have different
owners. An integration may support reading menus but not ordering or refunds.
Unsupported operations remain visible as unavailable or route to the owner's
application; they must not quietly create a competing local record.

Example: a contracted canteen retains menus/orders/POS; ThatCampus manages room
repairs and institution-level approvals; an ERP owns invoices; an approved payment
processor supplies payment evidence. The DT coordinates exact work across these
owners. It does not pretend the processor, canteen till and ERP are the same ledger.

## Implemented Dining reference boundary

The [Dining foundation](CAMPUS_DINING_AND_SERVICE.md#first-implementation-boundary)
lets menu ownership and serving ownership independently select `native` or
`reference`. One external-system metadata bundle belongs to a service; this is
not yet a general registry that assigns arbitrary providers to every capability.
Dated native records pin their source service revision and modes. Service defaults
can change for future dates, but ownership modes cannot silently change once dated
records exist. Historical records are not an automatic provider cutover.

A reference view labels its HTTPS link and metadata as reference-only, not
connected or synced. It does not fetch provider status, import provider records,
send orders, redeem allowances or call payment/refund APIs. Fully reference-only
services do not manufacture local dated operations. External actions are disabled
in Simulation; reference metadata grants no production credentials or effects.

These bounded modes allow a native menu with externally owned serving, or a
reference menu with native serving, without requiring Finance or replacing the
campus's provider. They do not deliver file exchange, SSO, identity mapping,
cross-provider reconciliation or the reviewed handover described below.

## One writer for each fact

Proposed effective-dated capability bindings identify institution, selected world,
scope/outlet, capability, owning system, supported actions, adapter/schema version,
freshness expectation, permitted disclosures and responsible human. Ownership of
the same fact must not overlap at a cutover. A binding is configuration, not a
generic EAV replacement for domain records or domain invariants.

- External references include provider, connection/account, tenant and object type;
  a provider's bare numeric ID is not a global identity.
- Link canonical People, places and resources explicitly through reviewed mappings.
  Equal names/emails do not establish identity, entitlement or authority.
- One person can have several provider references without becoming several campus
  people. A provider account never becomes a campus administrator automatically.
- Imported/read-through records carry source version, observed/received time and
  reconciliation state. Conflicts become owned work, not last-write-wins.
  Use a provider revision when available; otherwise declare the adapter's status
  query/reconciliation method. Timestamps alone do not establish source ordering.
- Local projections can aid discovery but remain read-only for externally owned
  facts. Corrections go to the owner; local annotations cannot rewrite its balance.
- Another tenant using the same vendor gains no access to this campus's records.

## DT-mediated external work

The same model-mediated process applies to native and connected capabilities:

1. An identified person issues a typed request, or a registered source reports an
   observation, against the exact source record.
2. Current authority, capability binding, revisions and effective Operating rules
   determine the permitted action and the responsible recipient.
3. The owning domain validates it and retains the command, evidence/outbox and
   correlated outcome. Core does not embed provider-specific business logic.
4. A permitted connector dispatches the exact external command with a durable
   operation reference. “Queued”, “sent”, “provider accepted” and “completed” are
   different states; a redirect or successful HTTP transport proves no payment.
5. Authenticated responses/webhooks, supported status queries or reviewed reports
   enter through registered-source observations and owning-domain reconciliation.
6. Only accepted evidence advances the authoritative outcome and configured next
   person's work. A timeout or disagreement stays visibly pending/needs review.

External authority is bounded to the registered integration and operation. A valid
webhook signature identifies a source; it does not bypass tenant mapping, object
validation, financial review or an institution's authorization rules.
Real callbacks resolve their institution/account from verified connection
provisioning, never from a caller-selected world header or a browser session.

### Recovery without duplicate effects

Adapters declare authentication, tenant/account binding, supported schemas,
idempotency, pagination, rate limits, retention and reconciliation capabilities.
Use signed ingress and replay protection where supported, deduplicated inboxes,
transactional outboxes, correlated external IDs and bounded configured retries.
Stale/repeated events cannot overwrite a newer accepted source revision or repeat
an effect. Valid newer cancellations, reversals, refunds and corrections still
follow their owning domain's explicit transitions; states are not universally monotonic.

Internal idempotency alone cannot guarantee exactly-once action at an external
provider. If its API cannot safely deduplicate or query an ambiguous operation,
hold the operation for reconciliation instead of blindly sending it again. A
balance/status read and a settlement report can have different clocks and meaning.
Show the last confirmed update and a responsible next action when disconnected.
No provider outage silently transfers write ownership to ThatCampus.

For file-only connections, retain import batch/version, row-to-object mappings,
validation and collision choices. A repeated export/import must not re-create
invoices or serving records. Human reports are labelled reports, not API verification.
Do not screen-scrape or store a staff member's password as an invented connector.

## Connecting and replacing are separate journeys

Connecting starts with one capability: select its owner, inspect actual supported
access, map the minimum identifiers, test read-only, review disclosures and enable
the necessary actions. Do not demand every provider or subsystem during onboarding.
Keep API credentials and sync machinery out of normal operator screens.

Replacing a provider, in either direction, is a reviewed handover:

1. Agree scope, effective cutover, owner and rollback/stop criteria.
2. Inventory pending orders, entitlements, disputes and financial records. Preview
   mappings and reconcile opening state without manufacturing historical events.
3. Use a read-only comparison period; shadow verification is not dual writing.
4. Pin dispatched operations to their ownership-binding version. Resolve in-flight
   operations before cutover or retain an explicit old-owner reconciliation path.
   Late callbacks settle the original operation, never silently change the new
   owner's opening balance or resurrect superseded work.
5. Fence old writes at the boundary and activate the new owner only when confirmed.
   If the old provider cannot enforce that fence, stop and resolve the operational
   risk rather than claiming a safe automatic cutover.
6. Route historical corrections/refunds to the agreed original owner or an explicit
   lawful migrated obligation. Retain provenance and explain where older work lives.
7. Revoke obsolete credentials and subscriptions after pending effects are resolved.

Export and exit are part of the design: preserve stable IDs, source references,
versions, attachments subject to access/retention, outstanding work and financial
reconciliation. Do not promise portable external records that contract/API access
does not permit. Replacing ThatCampus must be possible without losing the audit
explanation of its own accepted records.

## Security, Simulation and delivery gates

Use least-privilege institutional connections, secret rotation, purpose-limited
payloads and private evidence references. Provider staff receive exact assignments,
not automatic institution-wide visibility. No medical/financial detail in generic
coordination payloads or broad notification audiences.

Simulation uses the same domain adapters with isolated snapshots, run-local
identifiers and deterministic connector inputs. Live credentials, recipients and
production commands must be unreachable. An unsupported external capability is
explicitly unsupported, never simulated as a successful financial/physical fact.
Replaying history cannot resend provider commands.

Before calling a specific integration delivered, verify real documented API/access
support, scoped credentials, identifier mapping, revoked access, duplicate and
out-of-order events, ambiguous timeout recovery, missed-event reconciliation,
stale status, source-qualified correction, handover and unchanged Live/sibling
state under actual isolated Simulation. A mock alone proves neither provider
compatibility nor an available commercial integration.

## Current foundation versus missing implementation

Model Core specifies registered sources, typed observations, domain reconciliation,
side-effect isolation and adapter contracts. Implemented command receipts retain
pending/completed outcomes; source registration, observation ingress contracts,
integration recipients and an execution-effect envelope/router provide reusable
pieces. They do not constitute a general canteen/POS/ERP connector today:

- Dining's native/reference service modes and labelled source links are delivered
  foundation, not a transactional connector or general ownership registry.

- Actual registered observation capabilities currently cover Attendance/Gate, not
  arbitrary dining/accounting ingress. Generic authenticated tenant connection
  provisioning, health and reconciliation handling remain missing.
- The normal command gateway uses a human account actor. Provider-originated
  commands need an explicit identity/authority adapter, not user impersonation.
- No production port registration was found for the shared execution-effect router;
  current effect callers cover Simulation and existing provider clients use guarded
  direct calls. The envelope alone is not durable Live connector delivery.
- Existing Razorpay support is sandbox-only and deployment-global, not a tenant
  canteen/ERP ownership framework. Read-only calendar subscriptions are not
  bidirectional calendar ownership.
- A capability ownership registry, reliable per-connection inbox/outbox protocol
  and safe provider cutover are proposed, not delivered.

The [research notes](../VERIFICATION.md#dining)
record official API/file-exchange examples and their limitations. Each future
connection should add only typed bindings/adapters needed by a concrete workflow,
not a second integration runtime or generic ERP database. Do not postpone a simple
native workflow until an imagined universal connector platform is built.
