import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import "./planning-navigation.css";

export function PlanningNavigation() {
  const { pathname, search } = useLocation();
  const selected = pathname.endsWith("/calendar") ? "calendar" : pathname.endsWith("/weekly") ? "weekly" : "day";
  const params = new URLSearchParams(search);
  const context = new URLSearchParams();
  for (const key of ["school", "date", "class"]) if (params.has(key)) context.set(key, params.get(key)!);
  const suffix = context.size ? `?${context}` : "";
  const editorContext = new URLSearchParams(context);
  if (params.has("view")) editorContext.set("view", params.get("view")!);
  return <nav className="planning-navigation" aria-label="Timetable and calendar">
    <div className="planning-navigation__views">
      {[{ id: "day", label: "Timetable", path: "/principal/timetable" }, { id: "calendar", label: "Calendar", path: "/principal/calendar" }].map(item =>
        <Link key={item.id} to={item.path + suffix} aria-current={selected === item.id ? "page" : undefined}>{item.label}</Link>)}
    </div>
    <Link className="planning-navigation__edit" to={"/principal/timetable/weekly" + (editorContext.size ? `?${editorContext}` : "")}>
      <span>Schedule settings</span><ChevronRight size={17} aria-hidden="true" />
    </Link>
  </nav>;
}
