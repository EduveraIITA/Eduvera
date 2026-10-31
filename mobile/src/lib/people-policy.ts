export type PeopleAffiliation = 'learner' | 'worker' | 'contractor' | 'visitor' | 'other';
export type PeopleCapabilities = { can_correct_name?: boolean; can_edit_profile?: boolean; can_manage_connections?: boolean; can_manage_groups?: boolean; can_invite?: boolean; can_enroll?: boolean; can_add_work_profile?: boolean; can_link_guardian?: boolean };
export type PeopleAccount = { has_account?: boolean; account_state?: 'active' | 'inactive' | 'not_linked'; is_you?: boolean };

/** A name is retained whole; cultural/family-name boundaries are never inferred. */
export function peopleNameFields(value: string) {
  const name = value.trim();
  if (!name || name.length > 150) throw new Error('Enter a name of 1–150 characters.');
  return { first_name: name, last_name: '' };
}
export function peopleReason(value: string) {
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 500) throw new Error('Add a reason of 3–500 characters.');
  return reason;
}
export function isPeopleDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function peopleDates(start: string, end = '') {
  if (!isPeopleDate(start) || end && (!isPeopleDate(end) || end < start)) throw new Error('Choose valid dates. The last day cannot be before the first day.');
  return { starts_on: start, ends_on: end || null };
}
export function peopleContact(email: string, phone: string) {
  const contact_email = email.trim(), contact_phone = phone.trim();
  if (contact_email.length > 254 || contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) throw new Error('Enter a valid contact email or leave it blank.');
  if (contact_phone.length > 32) throw new Error('Use 32 characters or fewer for the phone number.');
  return { contact_email, contact_phone };
}
export function mayInvitePerson(person: PeopleAccount, capabilities: PeopleCapabilities | undefined, mode: 'live' | 'simulation') {
  return mode === 'live' && capabilities?.can_invite === true && person.is_you === false && person.has_account === false && person.account_state === 'not_linked';
}
export function peopleMemberIds(ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 2000 || unique.length !== ids.length || unique.some(id => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) throw new Error('Choose 1–2000 distinct campus people.');
  return unique;
}
export function invitationStatus(invitation: { accepted_at: string | null; revoked_at: string | null; expires_at: string }, now = Date.now()) {
  return invitation.accepted_at ? 'Accepted' : invitation.revoked_at ? 'Revoked' : Date.parse(invitation.expires_at) > now ? 'Pending' : 'Expired';
}
