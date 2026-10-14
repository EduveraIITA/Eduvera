# Matrix chat adoption record — 14 October 2026

User decision: adopt the open-source Matrix/Synapse/Element Call direction rather
than a paid chat API, preserving Eduvera's existing design and school controls.
This record supplements IMPLEMENTATION_PLAN.md; it is not a completed release gate.

## Implemented increment

The ChatService provider is now a backwards-compatible subclass which keeps all
existing message authorization, storage, moderation and notification paths. An
opt-in PostgreSQL trigger adds send/edit/soft-redaction events atomically to a
Matrix outbox. A separate worker sends them through a private application service.
School/user identities and school/conversation rooms are tenant-bound. Existing
aliases are scope-checked, non-members are removed before new events are sent,
and queued authors are checked again before delivery. Deterministic Matrix
transaction IDs support retries after a worker crash without duplicate sends.

The bridge is off for every school by default. Administrators may enable only
their own active school after a Matrix authentication check. Browser requests
never receive a Matrix service token. Synapse network failures do not extend the
normal message-send request. An authorized status endpoint reports pending and
blocked bridge work without claiming call availability or E2EE.

The deployment bundle includes Synapse/PostgreSQL plus isolated, opt-in lab
containers for Element Call/LiveKit/MatrixRTC authorization. No cloud resources
have been provisioned and no real school data has been moved.

## Deliberate boundaries and remaining work

This increment is an outgoing bridge, NOT the entire requested replacement.
PostgreSQL remains the read authority. Matrix sync, inbound Matrix events,
retention/hard-delete parity, historical migration, read-receipt projection,
voice-note capture, widget hosting and actual call acceptance/ringing/media are
not implemented. Do not call the feature complete or turn it on for live schools.
The extra Synapse/outbox copies are not end-to-end encrypted and require retention
and safeguarding review. Attachment contents remain behind the existing scoped
Eduvera attachment endpoint; this is not standalone Matrix-media interoperability.

## Evidence

- Twelve client-adapter contract tests passed locally with a Node test-runner
  adapter; five standard-library configuration tests passed locally.
- The new TypeScript files passed syntax transpilation, which is NOT a full
  project typecheck/build or lint result.
- Six PostgreSQL outbox tests are included for isolated seeded CI; not locally run.
- Full application CI, actual container boot, real Synapse integration, cross-school
  negative-path API checks and phone acceptance remain required.
- Feature branch/PR only; no Stage deployment claimed.

See [deployment and release gates](../../deploy/matrix/README.md).
