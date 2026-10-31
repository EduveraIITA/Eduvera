import { Navigate, useLocation } from "react-router-dom";
import type { AnalyticsAudience } from "./api";

export type InsightWorkspaceScope = "institution" | "assigned" | "self" | "dependent";

export function insightScopeForAudience(audience: AnalyticsAudience): InsightWorkspaceScope {
  if (audience === "principal") return "institution";
  if (audience === "teacher") return "assigned";
  if (audience === "student") return "self";
  return "dependent";
}

export function canonicalInsightsPath(topic = "", search = "") {
  const query = canonicalInsightSearch(search).replace(/^\?/, "");
  return `/areas/insights${topic ? `/${topic}` : ""}${query ? `?${query}` : ""}`;
}

/**
 * The audience remains a transport discriminator for the transitional analytics
 * endpoint. It contributes only the neutral workspace scope; it never selects a
 * portal, navigation shell or authority.
 */
export function insightPath(audience: AnalyticsAudience, topic = "", search = "") {
  const params = new URLSearchParams(canonicalInsightSearch(search));
  if (!params.has("scope")) params.set("scope", insightScopeForAudience(audience));
  return canonicalInsightsPath(topic, params.toString());
}

export function legacyInsightDestination(pathname: string, search = "", hash = "") {
  const match = pathname.match(/^\/(principal|teacher|parent|student)\/(?:analytics|insights)(?:\/(.*))?\/?$/);
  if (!match) return "/areas/insights";
  const audience = match[1] as AnalyticsAudience;
  const topic = (match[2] ?? "").replace(/\/+$/, "");
  return `${insightPath(audience, topic, search)}${hash}`;
}

/** Keep bookmark topic, learner context, filters and fragments intact. */
export function LegacyInsightsRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate replace to={legacyInsightDestination(pathname, search, hash)} />;
}

export const LegacyAnalyticsRedirect = LegacyInsightsRedirect;

export function canonicalInsightSearch(search: string) {
  const params = new URLSearchParams(search);
  if (!params.has("class") && params.has("insight_class")) params.set("class", params.get("insight_class")!);
  params.delete("insight_class");
  return params.size ? `?${params}` : "";
}
