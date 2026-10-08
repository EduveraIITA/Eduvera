import { Navigate, useLocation } from "react-router-dom";
import type { Portal } from "../auth/AuthContext";

export function insightPath(portal: Portal, topic = "", search = "") {
  const query = search.replace(/^\?/, "");
  return `/${portal}/insights${topic ? `/${topic}` : ""}${query ? `?${query}` : ""}`;
}

/** Keep shared bookmarks, learner context and reporting filters intact. */
export function LegacyAnalyticsRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate replace to={`${pathname.replace(/\/analytics(?=\/|$)/, "/insights")}${search}${hash}`} />;
}

export function canonicalInsightSearch(search: string) {
  const params = new URLSearchParams(search);
  if (!params.has("class") && params.has("insight_class")) params.set("class", params.get("insight_class")!);
  params.delete("insight_class");
  return params.size ? `?${params}` : "";
}
