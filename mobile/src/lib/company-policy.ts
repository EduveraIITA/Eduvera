export interface DirectoryInstitution { id: string; name: string; institution_type: string; source: 'UDISE' | 'AISHE' | 'MANUAL'; source_code: string | null; state: string; district: string; city: string; address: string; is_verified: boolean; is_onboarded: boolean; eduera_institution_id: string | null; onboarding_status: string; action: string }
export interface ManualInstitution { name: string; institution_type: string; state: string; district: string; city: string; address: string }
export const normalizeInstitutionCode = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,32).replace(/-+$/g,'');
export function companyInstitutionBody(input: { selected: DirectoryInstitution | null; manual: ManualInstitution | null; code: string; timezone: string; email: string; duplicates: DirectoryInstitution[]; acknowledged: boolean }) {
  const {selected, manual, duplicates} = input;
  if (!!selected === !!manual || selected?.is_onboarded) throw new Error('Choose an institution that is not already onboarded.');
  if (manual && (manual.name.trim().length < 2 || manual.name.trim().length > 180 || !manual.state.trim() || (!manual.district.trim() && !manual.city.trim()) || !manual.address.trim())) throw new Error('Enter the institution name, state, address and district or city.');
  const code = normalizeInstitutionCode(input.code);
  if (code.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw new Error('Enter a valid institution code and first administrator email.');
  try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }); } catch { throw new Error('Enter a valid timezone, such as Asia/Kolkata.'); }
  if (duplicates.length && !input.acknowledged) throw new Error('Review the possible existing institutions first.');
  const ids = duplicates.map(item => item.eduera_institution_id);
  if (ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) throw new Error('The duplicate review could not be confirmed. Search again.');
  return { name: selected?.name ?? manual!.name.trim(), code, institution_kind: ['college','university','standalone'].includes(selected?.institution_type ?? manual!.institution_type) ? 'college' : 'school', timezone: input.timezone, admin_email: input.email.trim(), ...(selected ? { directory_id: selected.id } : { manual }), acknowledged_duplicate_ids: input.acknowledged ? ids : [] };
}
