/**
 * Canonical Messages destination for notifications, attention projections and
 * assistant receipts. Relationship scope is emitted only as an exact pair; a
 * partial or non-relationship context deliberately falls back to the signed-in
 * person's responsibility-composed Messages area.
 */
export function messageConversationsHref(context = {}) {
    const parameters = new URLSearchParams();
    if (context.relationshipScope && context.studentId) {
        parameters.set("scope", context.relationshipScope);
        parameters.set("student_id", context.studentId);
    }
    if (context.conversationId)
        parameters.set("conversation", context.conversationId);
    return `/areas/messages/conversations${parameters.size ? `?${parameters.toString()}` : ""}`;
}
/**
 * One exact destination contract for every report notification and Requests
 * row. The protected-care page only resolves a report inside its message
 * reports section, so producers must never emit a generic safeguarding URL.
 */
export function safeguardingReportAttentionHref(_portal, reportId) {
    return `/areas/care/concerns?section=message_reports&report=${encodeURIComponent(reportId)}`;
}
//# sourceMappingURL=chat-links.js.map