const homes: Record<string, string> = { parent: "/parent/home", student: "/student", teacher: "/teacher", principal: "/principal" };
const catalogues: Record<string, string> = { parent: "/parent/more", student: "/student/apps", teacher: "/teacher/more", principal: "/principal/more" };
const homeOwnedModules: Record<string, ReadonlySet<string>> = {
  parent: new Set(["attendance", "diary"]),
  student: new Set(["attendance", "timetable"]),
  teacher: new Set(["attendance", "timetable"]),
  principal: new Set(["attendance", "insights", "timetable"]),
};
export function isPortalHome(path: string) { return ["/parent", ...Object.values(homes)].includes(path.replace(/\/$/, "")); }
export function isSecondaryPortalPage(path: string) { return /^\/(parent|student|teacher|principal)(\/|$)/.test(path) && !isPortalHome(path); }

// Back in the app moves up the information hierarchy, never into another
// portal or out to an unrelated browser-history entry. Explicit page handlers
// still own draft cancellation and query-based subpages.
export function portalParent(pathname: string, search: string, fallback: string) {
  const parts = pathname.split("/").filter(Boolean);
  const portal = parts[0] ?? "";
  const home = homes[portal];
  if (!home) return fallback;
  const base = `/${portal}`, module = parts[1];
  const source = new URLSearchParams(search), context = new URLSearchParams();
  if (module === "messages" && source.has("conversation")) {
    if (source.has("student_id")) context.set("student_id", source.get("student_id")!);
    return `${base}/messages${context.size ? `?${context}` : ""}`;
  }
  let target: string;
  if (module === "more" || module === "apps") target = home;
  else if (portal === "student" && module === "copilot") target = `${base}/attendance`;
  else if (module === "events" && parts.length > 3) target = `${base}/events/${parts[2]}`;
  else if (parts.length > 2) target = `${base}/${module}`;
  else if (homeOwnedModules[portal]?.has(module ?? "")) target = home;
  else target = catalogues[portal] ?? fallback;
  for (const key of ["student_id", "school"]) if (source.has(key)) context.set(key, source.get(key)!);
  if (target !== catalogues[portal] && target !== home) {
    for (const key of ["date", "class"]) if (source.has(key)) context.set(key, source.get(key)!);
  }
  return target + (context.size ? `?${context}` : "");
}
