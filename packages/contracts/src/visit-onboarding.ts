/** Gate-owned reusable onboarding locator. A locator grants no campus or entry authority. */
export interface VisitOnboardingLinkState {
  visit_id: string;
  visit_revision: number;
  revision: number;
  can_manage: boolean;
  can_issue: boolean;
  can_revoke: boolean;
  public_onboarding_supported: boolean;
  current: null | {
    id: string;
    revision: number;
    state: 'active' | 'revoked' | 'expired' | 'cancelled' | 'issuer_unavailable';
    ends_at: string;
    issued_at: string;
    registration_count: number;
  };
}
export interface VisitOnboardingLinkCommand {
  command_id: string;
  expected_revision: number;
  expected_visit_revision: number;
  action: 'issue' | 'revoke';
  ends_at?: string;
}
export interface VisitOnboardingLinkResult extends VisitOnboardingLinkState {
  receipt: { command_id: string; link_id: string; revision: number; action: 'issue' | 'revoke'; replayed: boolean };
  /** Only the explicit issue response exposes the credential. Never journal this field. */
  join_url: string | null;
}
export interface VisitOnboardingLinkReveal {
  visit_id: string; visit_revision: number; link_id: string; revision: number; ends_at: string; join_url: string;
}
export interface VisitOnboardingPreview {
  timezone: string;
  campus: { id: string; name: string };
  visit: { id: string; title: string; starts_at: string; ends_at: string; place_label: string };
  available_until: string;
  authentication_required: true;
}
export interface VisitOnboardingProof {
  challenge_id: string;
  expires_at: string;
  delivery: 'email_accepted' | 'unavailable';
  retry_after_seconds: number;
}
export interface VisitOnboardingAccountResult { status: 'created' | 'sign_in_required' }
export interface VisitOnboardingJoinResult {
  accepted: true;
  registration_id: string;
  school_id: string;
  visit_id: string;
  href: string;
  replayed: boolean;
}
export interface VisitParticipantView {
  timezone: string;
  registration: { id: string; registered_at: string; person_label: string; evidence: 'self_registered' };
  available_until: string;
  visit: { id: string; revision: number; title: string; state: 'confirmed' | 'cancelled'; starts_at: string; ends_at: string;
    place: { label: string; campus_label: string }; contact: { label: string } };
  /** Planned group size, registrations and observed movements are separate facts. */
  entry_permission: false;
  presence_confirmed: false;
}
export interface VisitParticipantList {
  timezone: string;
  visits: Array<{ id: string; title: string; state: 'confirmed' | 'cancelled'; starts_at: string; ends_at: string; href: string }>;
  pagination: { page: number; page_size: number; total: number; total_pages: number };
}
