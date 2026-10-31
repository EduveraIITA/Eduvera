import { sql } from "kysely";
/** One once/weekly date expansion shared by source owners. It grants no person,
 * room, attendance or execution claim and never persists an occurrence. */
export function recurrenceDays(input) {
    return sql `(SELECT candidate::date AS day FROM generate_series(GREATEST(${input.startsOn}::date,${input.from}::date-1),LEAST(COALESCE(${input.endsOn}::date,${input.until}::date),${input.until}::date),interval '1 day') candidate
    WHERE extract(isodow FROM candidate)=${input.weekday} AND(${input.kind}='weekly' OR candidate::date=${input.startsOn}::date))`;
}
const formatters = new Map();
function wallNumber(at, zone) {
    let formatter = formatters.get(zone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat("en-CA", {
            timeZone: zone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
        });
        if (formatters.size > 128)
            formatters.clear();
        formatters.set(zone, formatter);
    }
    const fields = Object.fromEntries(formatter
        .formatToParts(new Date(at))
        .map((part) => [part.type, part.value]));
    return Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day), Number(fields.hour), Number(fields.minute), Number(fields.second));
}
/** Return every existing instant for one declared wall time. No clock read,
 * automatic gap shift, locale parsing or fixed one-hour DST assumption. */
export function localInstantChoices(date, time, zone) {
    const wall = Date.parse(`${date}T${time.slice(0, 5)}:00Z`), offsets = new Set();
    for (const days of [-2, -1, 0, 1, 2]) {
        const at = wall + days * 86400000;
        offsets.add(wallNumber(at, zone) - at);
    }
    return [
        ...new Set([...offsets]
            .map((offset) => wall - offset)
            .filter((at) => wallNumber(at, zone) === wall)),
    ]
        .sort((a, b) => a - b)
        .map((at) => new Date(at).toISOString());
}
export function isAmbiguousLocalInstant(instant, zone) {
    const at = Date.parse(instant), wall = new Date(wallNumber(at, zone)).toISOString();
    return (localInstantChoices(wall.slice(0, 10), wall.slice(11, 16), zone).length > 1);
}
//# sourceMappingURL=shared-recurrence.js.map