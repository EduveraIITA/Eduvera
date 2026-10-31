import { config } from "../config.js";
export const demoSwitchRoles = ["student", "parent", "staff", "admin"];
export const demoSwitchUsernames = {
    student: "aarav.student",
    parent: "pooja.parent",
    staff: "kavita.staff",
    admin: "meera.principal",
};
export function demoProfileSwitcherEnabled() {
    return config().DEMO_PROFILE_SWITCHER_ENABLED && config().DEPLOYMENT_ENVIRONMENT !== "production";
}
export function isDemoSwitchUsername(username) {
    return Object.values(demoSwitchUsernames).includes(username);
}
//# sourceMappingURL=demo-profile-switcher.js.map