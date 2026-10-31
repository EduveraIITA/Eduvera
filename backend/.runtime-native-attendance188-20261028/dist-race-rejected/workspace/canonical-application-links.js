function withQuery(path, entries = []) {
    const query = new URLSearchParams();
    for (const [key, value] of entries) {
        if (value !== null && value !== undefined && String(value).length > 0)
            query.set(key, String(value));
    }
    return query.size ? `${path}?${query.toString()}` : path;
}
export function assessmentWorkHref(surface, assessmentId, extra = []) {
    return withQuery(`/areas/assessments/${surface}`, [
        ["assessment", assessmentId],
        ...extra.filter(([key]) => key !== "assessment"),
    ]);
}
export function assessmentResultsHref(scope, studentId, extra = []) {
    return withQuery("/areas/assessments/results", [
        ["scope", scope],
        ["student_id", studentId],
        ...extra.filter(([key]) => key !== "scope" && key !== "student_id"),
    ]);
}
export function eventWorkHref(surface, eventId, extra = []) {
    const path = eventId
        ? `/areas/events/${surface}/${encodeURIComponent(eventId)}`
        : `/areas/events/${surface}`;
    return withQuery(path, extra);
}
export function eventSessionAttendanceHref(surface, eventId, sessionId) {
    return `/areas/events/${surface}/${encodeURIComponent(eventId)}/sessions/${encodeURIComponent(sessionId)}/attendance`;
}
export function relationshipEventHref(scope, studentId, eventId, extra = []) {
    const path = eventId
        ? `/areas/events/calendar/${encodeURIComponent(eventId)}`
        : "/areas/events/calendar";
    return withQuery(path, [
        ["scope", scope],
        ["student_id", studentId],
        ...extra.filter(([key]) => key !== "scope" && key !== "student_id"),
    ]);
}
//# sourceMappingURL=canonical-application-links.js.map