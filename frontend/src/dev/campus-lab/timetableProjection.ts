import type { TimetableRehearsalIndicator } from "../../features/planner/rehearsal";
import type { CampusLabStatus } from "./api";

export function campusLabTimetableIndicator(status: CampusLabStatus | null | undefined): TimetableRehearsalIndicator | null {
  if (
    !status?.schedule
    || !status.phase
    || status.status !== "running"
    || status.phase.mode === "closed"
    || !status.schedule.reference_date
    || !status.schedule.simulated_at
  ) return null;
  return {
    label: "Simulated school day",
    status: status.status,
    referenceDate: status.schedule.reference_date,
    simulatedAt: status.schedule.simulated_at,
    phaseLabel: status.phase.label,
    phaseMode: status.phase.mode ?? "transition",
    nextChangeAt: status.phase.next_change_at,
    activeSlotIds: status.schedule.active_slot_ids,
    timeZone: "Asia/Kolkata",
    campusPath: "/principal/campus",
  };
}
