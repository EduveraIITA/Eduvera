import { accountName, accountNameChange } from './account-profile';
export interface PersonalProfile {
  user_id: string; first_name: string; last_name: string; email: string; revision: number;
  contact_phone: string; phone_verified: boolean; phone_verified_at: string | null;
  education_background: string; photo_override: boolean; photo_data_url: string | null;
  last_change_id: string | null; sms_available: boolean;
}
export function parsePersonalProfile(value: unknown): PersonalProfile {
  const p = value as PersonalProfile & {scope?: unknown; visibility?:unknown; background_evidence?:unknown} | null;
  if (!p || p.scope !== 'account' || p.visibility !== 'private' || p.background_evidence !== 'self_reported' || typeof p.user_id !== 'string' || !p.user_id || !Number.isSafeInteger(p.revision) || p.revision < 0 || typeof p.first_name !== 'string' || typeof p.last_name !== 'string' || typeof p.email !== 'string' || typeof p.contact_phone !== 'string' || p.contact_phone !== '' && !/^\+[1-9]\d{7,14}$/.test(p.contact_phone) || typeof p.education_background !== 'string' || p.education_background.length > 1000 || typeof p.phone_verified !== 'boolean' || typeof p.photo_override !== 'boolean' || typeof p.sms_available !== 'boolean' || p.last_change_id !== null && typeof p.last_change_id !== 'string' || p.phone_verified_at !== null && (typeof p.phone_verified_at !== 'string' || !Number.isFinite(Date.parse(p.phone_verified_at))) || p.phone_verified !== (p.phone_verified_at !== null) || p.phone_verified && !p.contact_phone || p.photo_data_url !== null && (typeof p.photo_data_url !== 'string' || p.photo_data_url.length > 720000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(p.photo_data_url))) throw new Error('Your personal profile could not be verified. Refresh before editing.');
  return p;
}
export function normalizedProfilePhone(value: string): string {
  const phone = value.trim().replace(/[\s().-]/gu,'');
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Include the country code, for example +91, or leave the phone empty.');
  return phone;
}
export function personalProfileChange(base: PersonalProfile, draft: {name:string;phone:string;background:string;photo?:string|null}, id: string) {
  const name=draft.name.trim();
  if (name !== accountName(base)) accountNameChange(name, base);
  const background=draft.background.trim(); if(background.length>1000 || /\p{Cc}/u.test(background.replace(/[\n\t]/gu,'')))throw new Error('Keep education or professional background under 1,000 characters, without control characters.');
  return { name,expected_first_name:base.first_name,expected_last_name:base.last_name,expected_revision:base.revision,client_request_id:id,contact_phone:normalizedProfilePhone(draft.phone),education_background:background,...(draft.photo===undefined?{}:{photo_data_url:draft.photo}) };
}
export interface PhoneChallenge { challenge_id:string;expires_at:string;retry_after_seconds:number;destination:string;sent:true }
export function parsePhoneChallenge(value: unknown):PhoneChallenge {
  const p=value as PhoneChallenge|null;
  if(!p || p.sent!==true || typeof p.challenge_id!=='string' || !/^[0-9a-f-]{36}$/i.test(p.challenge_id) || typeof p.expires_at!=='string' || !Number.isFinite(Date.parse(p.expires_at)) || !Number.isSafeInteger(p.retry_after_seconds) || p.retry_after_seconds<60 || typeof p.destination!=='string' || !/^•••• \d{4}$/.test(p.destination))throw new Error('SMS delivery was not confirmed. Your phone remains unverified.');
  return p;
}
