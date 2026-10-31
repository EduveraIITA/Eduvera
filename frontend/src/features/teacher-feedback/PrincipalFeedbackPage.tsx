import { Navigate, useLocation } from "react-router-dom";

/** Compatibility-only bookmark redirect. No feedback authority or UI lives here. */
export default function PrincipalFeedbackPage() {
  const location = useLocation();
  const parameters = new URLSearchParams(location.search);
  if (!parameters.has("view")) parameters.set("view", "coordinate");
  const query = parameters.toString();
  return <Navigate replace to={`/more/feedback${query ? `?${query}` : ""}${location.hash}`} />;
}
