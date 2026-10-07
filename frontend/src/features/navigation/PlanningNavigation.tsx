import { Link, useLocation } from "react-router-dom";
import "./planning-navigation.css";

export function PlanningNavigation() {
  const { pathname, search } = useLocation();
  const selected = pathname.endsWith("/calendar") ? "calendar" : pathname.endsWith("/weekly") ? "weekly" : "day";
  const params = new URLSearchParams(search);
  const context = new URLSearchParams();
  for (const key of ["school", "date"]) if (params.has(key)) context.set(key, params.get(key)!);
  const suffix = context.size ? `?${context}` : "";
  return <nav className="planning-navigation" aria-label="Timetable and calendar">
    {[{ id: "day", label: "Daily plan", path: "/principal/timetable" }, { id: "weekly", label: "Weekly timetable", path: "/principal/timetable/weekly" }, { id: "calendar", label: "Calendar", path: "/principal/calendar" }].map(item =>
      <Link key={item.id} to={item.path + suffix} aria-current={selected === item.id ? "page" : undefined}>{item.label}</Link>)}
  </nav>;
}
