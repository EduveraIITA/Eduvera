# Custom roles and permission catalogue

Admins and principals manage custom roles at `/principal/roles`. A role is scoped
 to one school and assigned to active staff. Admin/principal memberships are
protected; parent/student/guardian memberships cannot be changed by this flow.

| Group | Checkbox | Code |
| --- | --- | --- |
| School office | Manage students and school records | `sis.manage` |
| Finance | Manage fees and receipts | `fees.manage` |
| Attendance | View assigned registers | `attendance.view` |
| Attendance | Record attendance | `attendance.record` |
| Attendance | Use photo attendance | `photo.use` |
| Teaching | View timetable and day plans | `timetable.view` |
| Teaching | Respond to cover duties | `dayplans.respond` |
| Coordination | Manage attendance follow-ups | `followups.manage` |
| Communication | Read school messages | `messages.view` |
| Communication | Send school messages | `messages.send` |
| Communication | Create class groups | `groups.create` |
| Safeguarding | Review assigned incidents | `safeguarding.review` |
| Events | View assigned activities | `events.view` |
| Events | Manage assigned activities and tests | `events.manage` |
| Events | Record event attendance | `events.attendance` |
| Tools | Use AI assistance | `ai.use` |

Permissions are additional to membership and relationship checks. They do not
provide unassigned class access, unrelated child access, school-wide incident
access, consent authority or access to a different school. Read permissions and
write permissions are independent; choose the read checkbox alongside writes
when the user needs to operate the corresponding screen.

Creating/editing/assigning roles, managing access/invitations, changing payment
instructions, staff administration, weekly timetable editing and school-wide
incident assignment remain leadership actions. Personal staff leave and family
rights remain independent of delegated staff tools. Future domains must add a
server-enforced permission before adding a checkbox.

A custom role replaces default staff permissions and legacy SIS/finance grants
in its school. Choose **Default staff** to restore existing teacher tools and
legacy grants. An empty role has no delegated staff tools. Deactivated users or
memberships cannot use their assigned roles. Role edits and assignments are
freshly checked on API requests; open navigation refreshes on profile reload.

For Stage review, use **Admin view → More → Roles & permissions**. The Arjun Rao
persona and example roles are created by `seed-roles.ts` only with demo mode
explicitly enabled and an existing verified Cambridge demo school.
