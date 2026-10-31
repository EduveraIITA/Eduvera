/** Campus-local presentation and date queries share the same safe fallback. */
export function campusTimezone(campus?: string | null, school?: string | null): string {
  for (const candidate of [campus, school]) {
    const timezone = candidate?.trim();
    if (!timezone || timezone.length > 80) continue;
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
      return timezone;
    } catch { /* Retained setup data may contain a zone no longer supported. */ }
  }
  return "UTC";
}
