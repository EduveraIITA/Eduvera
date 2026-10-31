import { executionNow } from "../campus-model-core/execution-time.runtime.js";
function escapeText(value) {
    return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}
function utc(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime()))
        throw new Error('Invalid calendar timestamp.');
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
function day(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
        return value.replace(/-/g, '');
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}
function fold(line) {
    const chunks = [];
    let current = '';
    let bytes = 0;
    for (const char of line) {
        const size = Buffer.byteLength(char, 'utf8');
        if (current && bytes + size > 74) {
            chunks.push(current);
            current = ' ';
            bytes = 1;
        }
        current += char;
        bytes += size;
    }
    chunks.push(current);
    return chunks.join('\r\n');
}
export function serializeCalendar(input) {
    const stamp = utc(input.generatedAt ?? executionNow());
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ThatCampus//School Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        `X-WR-CALNAME:${escapeText(input.name)}`, `X-WR-TIMEZONE:${escapeText(input.timezone)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M'];
    for (const event of [...input.events].sort((a, b) => String(a.start).localeCompare(String(b.start)) || a.uid.localeCompare(b.uid))) {
        lines.push('BEGIN:VEVENT', `UID:${escapeText(event.uid)}`, `DTSTAMP:${stamp}`, `SEQUENCE:${event.sequence ?? 0}`, event.allDay ? `DTSTART;VALUE=DATE:${day(event.start)}` : `DTSTART:${utc(event.start)}`, event.allDay ? `DTEND;VALUE=DATE:${day(event.end)}` : `DTEND:${utc(event.end)}`, `SUMMARY:${escapeText(event.title)}`);
        if (event.description)
            lines.push(`DESCRIPTION:${escapeText(event.description)}`);
        if (event.location)
            lines.push(`LOCATION:${escapeText(event.location)}`);
        if (event.cancelled)
            lines.push('STATUS:CANCELLED');
        lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return `${lines.map(fold).join('\r\n')}\r\n`;
}
//# sourceMappingURL=ical.js.map