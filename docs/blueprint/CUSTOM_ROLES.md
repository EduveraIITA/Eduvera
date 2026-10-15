# Custom roles and scoped access

Current contract: [Roles and contextual assignments](WORK_PROFILE_ACCESS_ARCHITECTURE.md).
Updated: 15 October 2026.

The former single-role permission matrix, subsequent role/duty eligibility model, and
immutable “work type = workflow alias” model are superseded.

- Position is descriptive and grants no access.
- A role is a bundle of supported actions. Built-in roles are ready to use; an institution may
  customise a copy or create a role from scratch within the supported resource context.
- An assignment binds a person and role to a class, institution, event, assessment or journey.
  People may hold multiple scoped roles. Permissions are additive only within those scopes.
- Event, exam and journey staffing remains in the owning planning screen. The staff profile
  projects the same records; it does not require a duplicate assignment.
- Prerequisites are automatic. No raw permission identifiers, workflow programming or duty matrix
  is required in everyday staffing. Plain-language action selection is available when customising.
- Administrator membership and institutional governance authority cannot be created by custom roles.

Migration `052` implements the current model using the existing physical responsibility catalogue,
scoped bindings and native staffing access-role overrides. Earlier migrations and legacy identifiers
remain for compatibility; they are not a second source of operational authority.

Review: **Principal → More → Staff setup & leave → Roles**. The separate People profile contains
**Roles & assignments**. `npm run db:seed:access-roles` adds a read-only Attendance reviewer example
in demo mode without resetting existing choices. See the implementation plan for verified results
and deployment gates.

Gate access uses this same flow: **Manage In & Out** under **Gate & Safety** is
an institution-scoped action in a built-in or custom role, assigned to existing
staff from People. Gate & Safety links to Roles and People instead of showing a
separate gatekeeper-account creation form. Its QR and visitor tools remain there.
