import type { Portal } from "../auth/AuthContext";
import type { Tool } from "./tools";
import { ClipboardCheck } from "lucide-react";

type Group = { name: string; ids: string[] };
const groups: Record<Portal, Group[]> = {
  principal: [
    { name: "School overview", ids: ["analytics"] },
    { name: "People", ids: ["people", "staff", "teacher-feedback"] },
    { name: "Academics", ids: ["weekly", "assessments", "report-cards"] },
    { name: "Operations", ids: ["departure", "events", "messages", "fees", "safeguarding"] },
    { name: "Institute", ids: ["administration", "governance"] },
    { name: "Account", ids: ["security"] },
  ],
  teacher: [
    { name: "My work", ids: ["analytics", "responsibilities", "classes", "registers", "transport", "assessments", "report-cards"] },
    { name: "Schedule & activities", ids: ["weekly", "calendar", "events"] },
    { name: "Communication & care", ids: ["messages", "safeguarding"] },
    { name: "Administration", ids: ["delegated-people", "delegated-office", "delegated-fees", "member-invitations"] },
    { name: "Staff services", ids: ["leave", "policies"] },
    { name: "Account", ids: ["security"] },
  ],
  parent: [
    { name: "Learning", ids: ["analytics", "results", "diary", "teacher-feedback"] },
    { name: "Schedule & attendance", ids: ["timetable", "calendar", "leave"] },
    { name: "School life", ids: ["departure", "events", "messages"] },
    { name: "Payments & policies", ids: ["fees", "policies"] },
    { name: "Account", ids: ["security"] },
  ],
  student: [
    { name: "Learning", ids: ["analytics", "results", "diary", "teacher-feedback"] },
    { name: "Schedule & attendance", ids: ["timetable", "calendar", "attendance", "leave", "copilot"] },
    { name: "School life", ids: ["departure", "events", "messages"] },
    { name: "Payments & policies", ids: ["fees", "policies"] },
    { name: "Account", ids: ["security"] },
  ],
};

// A group is a visible heading, never another page to click through.
export function groupTools(portal: Portal, visible: Tool[]) {
  const known = new Set(groups[portal].flatMap(group => group.ids));
  const result = groups[portal].map(group => ({ name: group.name, tools: group.ids.flatMap(id => visible.filter(tool => tool.id === id)) }));
  const other = visible.filter(tool => !known.has(tool.id));
  if (other.length) result.push({ name: "Other tools", tools: other });
  return result.filter(group => group.tools.length);
}

type Shortcut = { owner: string; name: string; path: string; keywords?: string };
const adminShortcuts: Shortcut[] = [
  { owner: "people", name: "Import students", path: "/principal/students/import", keywords: "spreadsheet csv bulk enrol enroll" },
  { owner: "people", name: "Invite students & guardians", path: "/principal/invitations?role=guardian&from=students", keywords: "parent family invitation login" },
  { owner: "people", name: "Promote a class", path: "/principal/administration?section=promotion", keywords: "promotion next term" },
  { owner: "staff", name: "Invite staff", path: "/principal/invitations?role=staff&from=staff" },
  { owner: "staff", name: "Roles & permissions", path: "/principal/staff?section=roles", keywords: "access" },
  { owner: "staff", name: "Assign staff work", path: "/principal/staff?section=directory", keywords: "duties responsibilities assignments people" },
  { owner: "staff", name: "Staff leave", path: "/principal/staff?section=leave", keywords: "absence balance applications" },
  { owner: "staff", name: "Staff settings", path: "/principal/staff?section=policies", keywords: "leave policy" },
  { owner: "weekly", name: "Schedule settings", path: "/principal/timetable/weekly", keywords: "weekly timetable manage periods schedule subjects targets" },
  { owner: "weekly", name: "Calendar", path: "/principal/calendar", keywords: "month school dates holidays" },
  { owner: "report-cards", name: "Grading schemes", path: "/principal/report-cards?view=schemes", keywords: "grades bands" },
  { owner: "administration", name: "Academic setup", path: "/principal/administration?section=setup", keywords: "terms classes subjects" },
  { owner: "administration", name: "Account access", path: "/principal/administration?section=access", keywords: "members active deactivate invitations" },
  { owner: "administration", name: "Setup status", path: "/principal/activation", keywords: "onboarding activation readiness" },
  { owner: "administration", name: "Administrative history", path: "/principal/administration?section=audit", keywords: "audit changes" },
  { owner: "governance", name: "Institution profile", path: "/principal/governance?section=profile", keywords: "board affiliation registration" },
  { owner: "governance", name: "Policy register", path: "/principal/governance?section=register", keywords: "compliance policies" },
];
const aliases: Record<string, string> = {
  analytics: "analytics charts graphs insights overview trends progress statistics attendance scores",
  results: "marks marksheet exam report card grades", assessments: "tests exam marks marking moderation results",
  "report-cards": "marksheet grades grading term reports remarks", departure: "bus pickup drop collector route transport",
  transport: "bus pickup drop collector route roster", fees: "payment invoice receipt balance dues",
  leave: "absence absent application approval", diary: "homework notice announcement acknowledgement",
  security: "password mfa authenticator login email account", responsibilities: "duties assignments roles work",
  safeguarding: "safety welfare bullying confidential concern report", copilot: "attendance prediction eligibility",
};
export function searchTools(portal: Portal, visible: Tool[], query: string): Tool[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const grouped = groupTools(portal, visible);
  const entries = grouped.flatMap(group => group.tools.map(tool => ({ ...tool, description: group.name, keywords: `${tool.description} ${aliases[tool.id] ?? ""}` })));
  // Primary-tab destinations remain searchable without duplicating their rows in More.
  if (portal === "principal" || portal === "parent") entries.push({ id: "attendance", name: "Attendance", path: `/${portal}/attendance`, icon: ClipboardCheck, tone: "teal", description: "Attendance tab", keywords: "attendance presence absent registers" });
  const shortcuts = portal === "principal" ? adminShortcuts.flatMap(shortcut => {
    const owner = visible.find(tool => tool.id === shortcut.owner);
    const group = grouped.find(item => item.tools.some(tool => tool.id === shortcut.owner));
    return owner ? [{ ...owner, id: `shortcut:${shortcut.path}`, name: shortcut.name, path: shortcut.path, description: `${group?.name} › ${owner.name}`, keywords: shortcut.keywords ?? "" }] : [];
  }) : [];
  return [...entries, ...shortcuts].filter(tool => tokens.every(token => `${tool.name} ${tool.description} ${tool.keywords}`.toLocaleLowerCase().includes(token)));
}
