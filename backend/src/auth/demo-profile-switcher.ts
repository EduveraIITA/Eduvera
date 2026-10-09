import { config } from "../config.js";

export const demoSwitchRoles = ["student", "parent", "staff", "admin"] as const;
export type DemoSwitchRole = (typeof demoSwitchRoles)[number];

export const demoSwitchUsernames: Record<DemoSwitchRole, string> = {
  student: "aarav.student",
  parent: "pooja.parent",
  staff: "kavita.staff",
  admin: "meera.principal",
};

export function demoProfileSwitcherEnabled(): boolean {
  return config().DEMO_PROFILE_SWITCHER_ENABLED && config().DEPLOYMENT_ENVIRONMENT !== "production";
}

export function isDemoSwitchUsername(username: string): boolean {
  return Object.values(demoSwitchUsernames).includes(username);
}
