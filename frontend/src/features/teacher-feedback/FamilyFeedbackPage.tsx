import { Navigate, useLocation } from "react-router-dom";

/** Compatibility-only bookmark redirect. Eligibility is composed at /more/feedback. */
export default function FamilyFeedbackPage({ portal }: { portal: "parent" | "student" }) {
  const location = useLocation();
  const parameters = new URLSearchParams(location.search);
  if (!parameters.has("scope")) parameters.set("scope", portal === "parent" ? "dependent" : "self");
  if (!parameters.has("view")) parameters.set("view", "respond");
  const query = parameters.toString();
  return <Navigate replace to={`/more/feedback${query ? `?${query}` : ""}${location.hash}`} />;
}
