/** Institution-local wall times; never infer the campus zone from this device. */
const formats = new Map<string, Intl.DateTimeFormat>();
export function diningInput(value: string | Date, timeZone: string, precise = false) {
  const key = `${timeZone}:${precise}`;
  let format = formats.get(key);
  if (!format) { format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(precise ? { second: "2-digit", fractionalSecondDigits: 3 } as const : {}) }); if (formats.size >= 16) formats.clear(); formats.set(key, format); }
  const parts = format.formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}${precise ? `:${part("second")}.${part("fractionalSecond")}` : ""}`;
}
export function diningTimeOptions(value: string, timeZone: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) return [];
  const precise = value.length > 16, wall = Date.parse(`${value}${precise ? "" : ":00"}Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, value.length) !== value) return [];
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const instant = wall + hours * 3600000;
    offsets.add(Date.parse(`${diningInput(new Date(instant), timeZone, true)}Z`) - instant);
  }
  return [...new Set([...offsets].map(offset => new Date(wall - offset).toISOString()).filter(instant => diningInput(instant, timeZone, precise).slice(0, value.length) === value))].sort();
}
export function diningInstant(value: string, timeZone: string, fold = "") {
  const options = diningTimeOptions(value, timeZone);
  if (!options.length) throw new Error(`Choose a valid date and time in ${timeZone}. This time may not exist because the clocks change.`);
  if (options.length > 1 && !["earlier", "later"].includes(fold)) throw new Error("This time occurs twice. Choose the earlier or later occurrence.");
  return options[fold === "later" ? options.length - 1 : 0]!;
}
/** Existing evidence already identifies an exact occurrence of a repeated hour. */
export function diningFold(instant: string | Date, timeZone: string) {
  const options = diningTimeOptions(diningInput(instant, timeZone), timeZone);
  if (options.length < 2) return "";
  return Math.floor(new Date(instant).getTime() / 60000) === Math.floor(Date.parse(options.at(-1)!) / 60000) ? "later" : "earlier";
}
