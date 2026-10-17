# Campus Model Core verification audit — 17 October 2026

## Scope and conclusion

This audit verifies the Campus Model Core boundary that exists in this branch. It does not
declare the full target in `THATCAMPUS_MODEL_CORE_BLUEPRINT.md` complete. The implemented
boundary now migrates and seeds from zero on PostgreSQL 17, and the entire backend suite passes
with destructive database integration suites explicitly enabled.

Final evidence:

- fresh PostgreSQL **17.11** database;
- every migration applied from `001` through `133`, plus the dated Matrix migration;
- the complete Cambridge demo seed loaded successfully;
- **418** active retained human agents and **418** current ThatCampus account endpoints after
  identity reconciliation;
- TypeScript production build passed;
- scoped ESLint for every changed TypeScript test/seed file passed with zero warnings;
- Python seed/directory suite passed **12/12**;
- backend Vitest suite passed **1,220/1,220** across **167/167** files with
  `TEST_DATABASE_ISOLATED=true`;
- `git diff --check` passed.

The test database was disposable and loopback-only. No shared, stage or production database was
used. PostgreSQL 14 was deliberately rejected as final evidence because migration 033 already
uses the project's PostgreSQL 17 target syntax.

## Verification layers

1. **Migration from zero** — validates ordering, constraints, triggers, RLS installation and the
   new institution/realm provisioning chain without relying on an upgraded local database.
2. **Full seed and replay-sensitive reconciliation** — validates generated school data,
   institution roles, retained people agents, governance, configured coordination packs, access
   roles and the Campus Lab replica.
3. **Whole-model integrity audit** — validates one Live realm/address for Cambridge, structural
   institution identity, exact active contract pins, one current account endpoint for every
   active seeded account, no cross-address entities/relationships/observations/events, and no
   partially certified Attendance evidence.
4. **Domain and API integration** — executes Attendance, People, timetable, governance,
   assessment, examination, transport, finance, gate, communication, Agent and Simulation tests
   against the disposable database.
5. **Failure and concurrency boundaries** — exercises stale revisions, idempotent retries,
   cross-tenant rejection, transaction rollback, authority rechecks, interrupted agent writes,
   expired actions, message scope and out-of-order event publication.
6. **Static architecture regressions** — verifies the Core persistence boundary, ModelAddress
   isolation, execution-environment separation, contract registry, command gateway and domain
   bridge source constraints.

## Defects found and corrected

### Post-migration institutions lacked a realm

Migration 124 backfilled institutions that existed at migration time, but a later school insert
could exist without an `OperationalRealm` or Live namespace. Migration 131 now provisions these
atomically for every new institution and repairs the transition window.

### Realm ownership blocked legitimate empty-institution cleanup

The compatibility school-to-realm and realm-to-namespace foreign keys used `RESTRICT`, so tests
and administrative rollback could not remove a newly created, otherwise empty institution.
Migration 132 makes the school own its realm and the realm own its namespaces with cascading
deletion. Model records below a namespace retain restrictive references and must still be retired
or removed through their owning domains.

### New realms lacked reviewed contract pins and structural identity

Contract activation and institution-entity backfills only covered realms present when migrations
102/125 ran. Attendance correctly rolled back rather than writing uncertified evidence, but that
made a newly provisioned institution unusable. Migration 133 now pins active reviewed semantic,
protocol and capability contracts and creates the structural institution entity during realm
provisioning. These are schema/compatibility pins, not Operating rules or automatic behaviour.

### Demo data loaded after migrations lacked retained human agents

The generated Cambridge school is inserted after migration backfills. The guarded
`seed-human-agent-identities.ts` reconciliation now maps explicit Student, Guardian, Staff and
Governance person identities to one stable human agent and one current account endpoint. It is
strictly scoped to the Cambridge demo and fails closed on ambiguous or unresolved identity.

### Campus Lab records were not fully address-qualified

The Campus Lab seed assumed a primary campus already existed and wrote relationships without the
required realm/environment address. It now creates/reuses the primary campus and writes both
relationship endpoints inside the same resolved Live ModelAddress. A database integration test
guards this convergence.

### Direct gatekeeper provisioning bypassed retained identity

The private stage gatekeeper operation created a real Staff person/account but no Core agent or
account endpoint. It now creates the human agent and endpoint in the same transaction before
publishing the access event. Its integration test verifies the mapping.

### Integration fixtures selected ambiguous institutions

Several tests selected “the first admin” after earlier suites had created temporary memberships.
They now identify the Cambridge fixture explicitly by stable username and school code. This fixes
test-order dependence without weakening tenant checks.

## Explicit remaining blueprint gaps

Passing tests establishes correctness of the implemented boundary, not completion of the target
Core. The following remain open and continue to be release gates:

- complete validate/rehearse/approve/schedule/activate behaviour administration;
- safe general selectors plus durable reaction workers, leases, retries, expiry, dead-letter and
  loop/fan-out budgets;
- complete mailbox claim/reassign/channel APIs and effective-dated team membership;
- general authority resolution across all roles/appointments;
- command-gateway adoption by every material domain mutation, durable denied/failed evidence, and
  recovery of abandoned `pending`/`uncertain` commands;
- every enabled domain's snapshot capture/restore adapter, encrypted artifact transport,
  privileged retention executor and quarantine release tooling;
- production administration for configured coverage, transport and invigilation timing,
  escalation and fallback;
- general replay/rebuild support tooling, automation explanation APIs, and hosted multi-instance
  Simulation storage;
- removal of the transitional adapters and direct-read allowlist identified in the current Core
  blueprint.

No production-readiness or full-model-completeness claim should be made until those gates are
implemented and separately evidenced.
