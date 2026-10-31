import type { AccommodationRoom, StayDetail } from '../../../packages/contracts/src/wire/features/accommodation/accommodationApi';
export function accommodationInitialInterval(now: string) {
  if (!Number.isFinite(Date.parse(now))) return null;
  const end = new Date(Date.parse(now) + 86400000); if (!Number.isFinite(end.getTime())) return null;
  return { starts: now, ends: end.toISOString() };
}
export function accommodationObservedTime(observed: string, now: string) {
  if (!Number.isFinite(Date.parse(now)) || !Number.isFinite(Date.parse(observed)) || Date.parse(observed) > Date.parse(now)) throw new Error('Choose an actual observation time no later than the confirmed campus clock.');
  return observed;
}
export function accommodationPlannedInterval(starts: string, ends: string) {
  if (!Number.isFinite(Date.parse(starts)) || !Number.isFinite(Date.parse(ends)) || Date.parse(ends) <= Date.parse(starts)) throw new Error('Choose valid planned start and end times, with the end after the start.');
  return { starts_at: starts, ends_at: ends };
}
export function reviewedAccommodationStay(basis: StayDetail, current: StayDetail, action: string) {
  if (current.id !== basis.id || !Number.isSafeInteger(basis.revision) || basis.revision < 1 || current.revision !== basis.revision || current.recovery_only !== basis.recovery_only || current.allowed_actions[action as keyof typeof current.allowed_actions] !== true) throw new Error('The saved stay or responsibility changed. Your entries are kept; review the current source before continuing.');
  return current;
}
export function reviewedAccommodationRoom(basis: AccommodationRoom, current: AccommodationRoom | undefined, canOffer: boolean) {
  if (!canOffer || !current || current.id !== basis.id || current.revision !== basis.revision || !current.active) throw new Error('The selected room or arrangement access changed. Keep your entries and review its current residential use.');
  return current;
}
