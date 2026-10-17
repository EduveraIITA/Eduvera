export interface TimetableRehearsalIndicator {
  label: string;
  status: "booting" | "running" | "paused" | "degraded";
  referenceDate: string;
  simulatedAt: string;
  phaseLabel: string;
  phaseMode: "arrival" | "lesson" | "break" | "activity" | "transition" | "departure" | "closed";
  nextChangeAt: string | null;
  activeSlotIds: string[];
  timeZone: string;
  campusPath: string;
}

export function resolveTimetableDisplayDate(
  explicitDate: string | null | undefined,
  rehearsal: TimetableRehearsalIndicator | null | undefined,
  fallbackDate: string,
) {
  return explicitDate || rehearsal?.referenceDate || fallbackDate;
}

export function timetableRehearsalInstant(
  rehearsal: TimetableRehearsalIndicator | null | undefined,
  fallback = new Date(),
) {
  if (!rehearsal) return fallback;
  const simulated = new Date(rehearsal.simulatedAt);
  return Number.isNaN(simulated.getTime()) ? fallback : simulated;
}

export function timetableRehearsalPeriodIsActive(
  rehearsal: TimetableRehearsalIndicator | null | undefined,
  date: string,
  periodId: string,
) {
  return Boolean(
    rehearsal
      && rehearsal.referenceDate === date
      && rehearsal.activeSlotIds.includes(periodId),
  );
}
