const homes: Record<string, string> = { parent: "/parent/home", student: "/student", teacher: "/teacher", principal: "/principal" };
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
  let target: string;
  if (module === "more" || module === "apps") target = home;
  else if (module === "events" && parts.length > 3) target = `${base}/events/${parts[2]}`;
  else if (parts.length > 2) target = `${base}/${module}`;
  else if (["attendance", "timetable"].includes(module ?? "") || (portal === "parent" && module === "diary")) target = home;
  else target = `${base}/${portal === "student" ? "apps" : "more"}`;
  const source = new URLSearchParams(search), context = new URLSearchParams();
  for (const key of ["student_id", "school"]) if (source.has(key)) context.set(key, source.get(key)!);
  if (!target.endsWith("/more") && !target.endsWith("/apps") && target !== home) {
    for (const key of ["date", "class"]) if (source.has(key)) context.set(key, source.get(key)!);
  }
  return target + (context.size ? `?${context}` : "");
}
