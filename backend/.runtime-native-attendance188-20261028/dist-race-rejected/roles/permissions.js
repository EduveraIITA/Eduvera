import { SetMetadata } from "@nestjs/common";
export const PERMISSION_METADATA = "eduera:permission";
export const RequirePermission = (permission) => SetMetadata(PERMISSION_METADATA, permission);
export const PERMISSIONS = [
    { code: "gate.manage", group: "Gate & Safety", label: "Manage In & Out", description: "Scan gate QR passes, verify student movements and record visitors. Does not approve departure plans or grant collection authority." },
    { code: "members.invite", group: "Onboarding", label: "Invite school members", description: "Invite or revoke staff, student and guardian access within this institution. Administrator invitations and role assignment stay with school admins." },
    { code: "sis.manage", group: "School office", label: "Manage students and school records", description: "Maintain student records, terms, classes, guardians and enrolments. Includes directory, reviewed enrollment and student imports." },
    { code: "fees.manage", group: "Finance", label: "Manage fees and receipts", description: "View the school ledger, create invoices, record payments and review payment submissions." },
    { code: "resources.manage", group: "Resources", label: "Manage borrowing", description: "Record item issues and manage loans you explicitly hold as custodian. Does not grant another custodian's private review or prove physical handover." },
    { code: "facilities.manage", group: "Facilities", label: "Manage repair intake", description: "Configure repair intake and recover missing responsibility. An assigned person can handle their own repair without this permission. Does not grant access to every private report, spending approval or room entry." },
    { code: "accommodation.manage", group: "Facilities", label: "Manage accommodation", description: "Register residential rooms, offer accommodation and recover missing coordination. Does not imply a resident's consent, actual occupancy, private access to every stay or authority to issue keys." },
    { code: "dining.manage", group: "Dining", label: "Set up dining services", description: "Configure dining services and recover missing responsibility. Named coordinators and operators act only on their assigned services; this does not grant financial authority or access to unrelated private issues." },
    { code: "attendance.view", group: "Attendance", label: "View assigned registers", description: "Read attendance registers and correction history within the role's class or appointed activity scope." },
    { code: "attendance.record", group: "Attendance", label: "Record attendance", description: "Record and submit attendance within the assigned class scope. Campus activity registers also require explicit appointment as their recorder." },
    { code: "attendance.review", group: "Attendance", label: "Review and finalize activity attendance", description: "Review evidence, finalize or reopen campus activity registers only when explicitly appointed as their reviewer. Does not grant recording or appointment authority." },
    { code: "photo.use", group: "Attendance", label: "Use photo attendance", description: "Review photo attendance and manage samples within the existing authorised class scope." },
    { code: "timetable.view", group: "Teaching", label: "View timetable and day plans", description: "Read published teaching schedules and assigned day plans." },
    { code: "dayplans.respond", group: "Teaching", label: "Respond to cover assignments", description: "Accept or decline assigned day-plan coverage." },
    { code: "learning.work.publish", group: "Teaching", label: "Publish class practice", description: "Publish text practice and read reported completion in an explicitly assigned class. Does not grant attendance, grading or other teachers' private threads." },
    { code: "learning.assignments.manage", group: "Teaching", label: "Manage class assignments", description: "Publish assignments and review submitted work only in an explicitly assigned class or subject. Does not grant attendance, other teachers' work or grading authority." },
    { code: "learning.sessions.manage", group: "Teaching", label: "Teach scheduled sessions", description: "Prepare shared resources and record taught topics only for your scheduled or accepted-cover sessions in the appointed scope. Does not grant attendance, assignment review or private student conversations." },
    { code: "followups.manage", group: "Coordination", label: "Manage attendance follow-ups", description: "Raise and review follow-ups for assigned students; guardian rights remain separate." },
    { code: "messages.view", group: "Communication", label: "Read school messages", description: "Read conversations and permitted recipients under existing messaging relationships." },
    { code: "messages.send", group: "Communication", label: "Send school messages", description: "Start conversations, send and edit own messages and upload attachments." },
    { code: "groups.create", group: "Communication", label: "Create class groups", description: "Create supported groups within existing class and school policy." },
    { code: "safeguarding.review", group: "Safeguarding", label: "Review assigned incidents", description: "Read and act on incidents assigned to the staff member. No school-wide case access." },
    { code: "events.view", group: "Events", label: "View assigned activities", description: "Read eligible events, options, rosters and attendance history." },
    { code: "events.manage", group: "Events", label: "Manage assigned activities and tests", description: "Create and update class activities/tests within existing staff event assignments." },
    { code: "events.attendance", group: "Events", label: "Record event attendance", description: "Submit attendance for assigned event sessions." },
    { code: "assessments.view", group: "Assessments", label: "View assigned assessments", description: "Read schedules and result registers only for explicitly assigned assessments." },
    { code: "assessments.mark", group: "Assessments", label: "Record assessment results", description: "Enter marks, result states and evidence only as the assigned examiner." },
    { code: "assessments.moderate", group: "Assessments", label: "Moderate assessment results", description: "Approve or return a complete result register only as its assigned moderator." },
    { code: "reports.comment", group: "Assessments", label: "Add report remarks", description: "Add remarks only for an actively assigned class before report review." },
    { code: "departure.manage", group: "Departure", label: "Manage departure", description: "Configure collection authority, departure plans, transport routes, trip rosters and exceptions." },
    { code: "departure.collect", group: "Departure", label: "Operate assigned trips", description: "Start only assigned trips, share journey location and record rider outcomes." },
    { code: "ai.use", group: "Tools", label: "Use AI assistance", description: "Use existing permission-scoped AI tools." },
];
export const DEFAULT_STAFF_PERMISSIONS = PERMISSIONS.map((permission) => permission.code).filter((code) => code !== "gate.manage" && code !== "sis.manage" && code !== "fees.manage" && code !== "resources.manage" && code !== "facilities.manage" && code !== "accommodation.manage" && code !== "dining.manage" && code !== "members.invite" && code !== "attendance.review" && code !== "learning.work.publish" && code !== "learning.assignments.manage" && code !== "learning.sessions.manage");
//# sourceMappingURL=permissions.js.map