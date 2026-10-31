const catalogue = [
    { key: "attendance", label: "Attendance", description: "Registers and attendance follow-up", href: "/areas/attendance", icon: "attendance", prefixes: ["attendance", "photo", "followups"] },
    { key: "timetable", label: "Timetable", description: "Your schedules, sessions and cover", href: "/areas/timetable", icon: "timetable", prefixes: ["timetable", "schedule"] },
    // Calendar projects authorized domain schedules and published availability;
    // it is not a new permission, reservation owner or second schedule editor.
    { key: "calendar", label: "Calendar", description: "Campus dates, schedules and activities", href: "/areas/calendar", icon: "calendar", prefixes: [] },
    { key: "in-out", label: "In & Out", description: "Authorized entry, exit and visitor operations", href: "/areas/in-out", icon: "gate", prefixes: ["gate"] },
    { key: "assessments", label: "Assessments", description: "Examination and assessment work", href: "/areas/assessments", icon: "work", prefixes: ["assessments", "assessment_invigilation"] },
    { key: "events", label: "Events", description: "Campus events and assigned activities", href: "/areas/events", icon: "calendar", prefixes: ["events"] },
    { key: "messages", label: "Messages", description: "Conversations connected to your campus work", href: "/areas/messages", icon: "messages", prefixes: ["messages", "groups", "chat"] },
    { key: "departure", label: "Departure", description: "Handover, journey and collection work", href: "/areas/departure", icon: "gate", prefixes: ["departure", "transport"] },
    { key: "reports", label: "Reports", description: "Learning reports and authorized remarks", href: "/areas/reports", icon: "insights", prefixes: ["reports", "grading"] },
    { key: "insights", label: "Insights", description: "Authorized trends, review and operational evidence", href: "/areas/insights", icon: "insights", prefixes: ["insights"] },
    { key: "people", label: "People", description: "People and groups within your responsibility", href: "/areas/people", icon: "people", prefixes: ["sis", "members"] },
    { key: "fees", label: "Fees", description: "Authorized fee and receipt operations", href: "/areas/fees", icon: "resources", prefixes: ["fees"] },
    { key: "resources", label: "Resources & borrowing", description: "Items, loans and borrowing questions", href: "/areas/resources", icon: "resources", prefixes: ["resources"] },
    { key: "facilities", label: "Repairs & maintenance", description: "Report problems and follow repairs", href: "/areas/facilities", icon: "facilities", prefixes: ["facilities"] },
    { key: "accommodation", label: "Accommodation", description: "Places, stays, moves and temporary access", href: "/areas/accommodation", icon: "accommodation", prefixes: ["accommodation"] },
    { key: "dining", label: "Dining", description: "Menus, serving hours and service follow-up", href: "/areas/dining", icon: "dining", prefixes: ["dining"] },
    { key: "responsibilities", label: "Staff work", description: "Duties, leave and accepted cover", href: "/areas/responsibilities", icon: "work", prefixes: ["staff", "coverage", "responsibilities"] },
    { key: "assistant", label: "Assistant", description: "ThatCampus AI within your authorized context", href: "/areas/assistant", icon: "work", prefixes: ["ai"] },
    { key: "care", label: "Student care", description: "Restricted care and safeguarding work", href: "/areas/care", icon: "work", prefixes: ["safeguarding", "restricted_care"] },
];
export const relationshipAreaKeys = {
    self: ["attendance", "timetable", "messages", "assessments", "events", "reports", "insights", "fees", "departure"],
    dependent: ["attendance", "timetable", "messages", "assessments", "events", "reports", "insights", "fees", "departure"],
};
export function allWorkspaceAreaDefinitions() {
    return catalogue;
}
export function workspaceAreaForCapability(capability) {
    if (capability === "learning.sessions.manage")
        return catalogue.find(entry => entry.key === "timetable");
    const prefix = capability.split(/[.:]/, 1)[0] ?? capability;
    const exact = catalogue.find((entry) => entry.prefixes.includes(prefix));
    return exact ? { key: exact.key, label: exact.label, description: exact.description, href: exact.href, icon: exact.icon } : null;
}
export function assignmentScopeKey(assignment) {
    return `${assignment.scope.kind}:${assignment.scope.id ?? ""}:${assignment.scope.label ?? ""}`;
}
export function uniqueWorkspaceScopes(scopes) {
    const found = new Map();
    for (const scope of scopes) {
        const key = `${scope.kind}:${scope.id ?? ""}:${scope.label ?? ""}`;
        if (!found.has(key))
            found.set(key, scope);
    }
    return [...found.values()];
}
//# sourceMappingURL=workspace-area.catalogue.js.map