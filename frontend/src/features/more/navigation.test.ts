import { describe, expect, it } from "vitest";
import { groupTools, searchTools } from "./navigation";
import { toolsFor } from "./tools";
import { teacherToolIsVisible } from "../auth/staffAccess";

describe("More hierarchy", () => {
  it.each(["principal", "teacher", "parent", "student"] as const)("places every %s destination in exactly one non-empty group", portal => {
    const tools = toolsFor(portal);
    const grouped = groupTools(portal, tools);
    const ids = grouped.flatMap(group => group.tools.map(tool => tool.id));
    expect(new Set(ids).size).toBe(tools.length);
    expect(ids).toHaveLength(tools.length);
    expect(grouped.every(group => group.tools.length > 0 && group.name !== "Other tools")).toBe(true);
  });

  it("keeps tasks below their owning admin module", () => {
    const tools = toolsFor("principal");
    expect(tools.some(tool => ["member-invitations", "import", "activation", "calendar"].includes(tool.id))).toBe(false);
    expect(searchTools("principal", tools, "invite staff")).toEqual(expect.arrayContaining([expect.objectContaining({ path: "/principal/invitations?role=staff&from=staff", description: "People › Staff" })]));
    expect(searchTools("principal", tools, "grading")).toEqual(expect.arrayContaining([expect.objectContaining({ path: "/principal/report-cards?view=schemes" })]));
    expect(searchTools("principal", tools, "permission")).toEqual(expect.arrayContaining([expect.objectContaining({ path: "/principal/staff?section=roles" })]));
  });

  it("does not reveal unauthorized work or empty groups in restricted staff search", () => {
    const member = { id: "m", school_id: "s", school_name: "School", role: "staff" as const, permissions: ["departure.collect"] };
    const visible = toolsFor("teacher").filter(tool => teacherToolIsVisible(member, tool.id));
    expect(groupTools("teacher", visible).map(group => group.name)).toEqual(["My work", "Staff services", "Account"]);
    expect(searchTools("teacher", visible, "marks")).toEqual([]);
    expect(searchTools("teacher", visible, "bus")[0]?.path).toBe("/teacher/transport");
  });

  it("matches familiar task names without cross-portal results", () => {
    expect(searchTools("parent", toolsFor("parent"), " MARKSHEET ")[0]?.path).toBe("/parent/results");
    expect(searchTools("student", toolsFor("student"), "password")[0]?.path).toBe("/account/security");
    expect(searchTools("parent", toolsFor("parent"), "invite staff")).toEqual([]);
    expect(searchTools("parent", toolsFor("parent"), "attendance")).toEqual(expect.arrayContaining([expect.objectContaining({ path: "/parent/attendance" })]));
  });
});
