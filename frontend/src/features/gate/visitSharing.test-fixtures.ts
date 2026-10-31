import type { SharedVisitDetail, VisitSharing } from "./visitSharingApi";
import { visitFixture } from "./visits.test-fixtures";
export const organiser = { id: "organiser", label: "Kavita Sen", revision: 3, has_app_access: true };
export function visitSharingFixture(patch: Partial<VisitSharing> = {}): VisitSharing {
  return { visit_revision: 1, share_revision: 1, can_share: true, can_open_shared: false, current: { id: "share-1", root_id: "root-1", revision: 1, organiser, starts_at: "2026-10-26T10:00:00Z", ends_at: "2027-10-27T10:00:00Z", directions: "Use the east entrance, then reception.", state: "active", owner: { id: "coordinator", label: "Meera Das", available: true }, can_renew: true, can_revoke: true, can_takeover: false, invitation: null }, ...patch };
}
export function sharedVisitFixture(patch: Partial<SharedVisitDetail> = {}): SharedVisitDetail {
  const visit = visitFixture();
  return { timezone: "UTC", visit: { id: visit.id, revision: visit.revision, title: visit.title, guest_label: visit.guest_label, party_size: visit.party_size, starts_at: visit.starts_at, ends_at: visit.ends_at, place: visit.place, contact: { label: visit.contact.label }, state: visit.state }, share: { id: "share-1", root_id: "root-1", revision: 1, starts_at: "2026-10-26T10:00:00Z", ends_at: "2027-10-27T10:00:00Z", directions: "Use the east entrance, then reception.", owner: { label: "Meera Das", available: true }, can_ask: true, can_reply: false }, changes: [], changes_has_more: false, question: null, ...patch };
}
