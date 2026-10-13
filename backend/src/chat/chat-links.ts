export type SafeguardingPortal = "teacher" | "principal";

/**
 * One exact destination contract for every report notification and Requests
 * row. The protected-care page only resolves a report inside its message
 * reports section, so producers must never emit a generic safeguarding URL.
 */
export function safeguardingReportAttentionHref(
  portal: SafeguardingPortal,
  reportId: string,
): string {
  return `/${portal}/safeguarding?section=message_reports&report=${encodeURIComponent(reportId)}`;
}
