import type { FacilitiesOptions, FacilitiesPerson, FacilitiesSettings, RepairAction, RepairDetail } from '../../../packages/contracts/src/wire/features/facilities/facilitiesApi';
import type { RecordedCommand } from './recorded-command';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
export type FacilitiesChoice = { id: string; label: string; revision?: number; hasAppAccess?: boolean; mapStatus?: boolean };
export function facilitiesPeople(value: unknown): Array<FacilitiesPerson & { revision: number; has_app_access: boolean }> {
  const data = value as FacilitiesOptions | null;
  if (!data || !Array.isArray(data.people) || data.people.length > 26 || !data.pagination || !positive(data.pagination.page) || data.pagination.page_size !== 25 || typeof data.pagination.people_has_more !== 'boolean') throw new Error('Current campus people could not be verified.');
  const people = data.people.map(person => { if (!uuid(person.id) || typeof person.label !== 'string' || !person.label.trim() || !positive(person.revision) || typeof person.has_app_access !== 'boolean') throw new Error('A current campus person could not be verified.'); return { id: person.id, label: person.label, revision: person.revision, has_app_access: person.has_app_access, ...(typeof person.can_manage === 'boolean' ? { can_manage: person.can_manage } : {}) }; });
  if (new Set(people.map(person => person.id)).size !== people.length) throw new Error('Current people choices have conflicting identities.'); return people;
}
export function facilitiesReportBody(settings: FacilitiesSettings, input: { problem: string; location: string; urgent: boolean; selected: ({ kind: 'places' | 'holdings' } & FacilitiesChoice) | null; place?: FacilitiesChoice | null; reporter: FacilitiesChoice | null; impact: 'not_working' | 'degraded' | null }) {
  const problem = input.problem.trim(), location_note = input.location.trim();
  if (!settings.configured || problem.length < 3 || problem.length > 2000 || location_note.length > 300 || !input.selected && location_note.length < 3 || input.selected && !uuid(input.selected.id) || input.place && (input.selected?.kind !== 'holdings' || !uuid(input.place.id)) || input.reporter && (!settings.can_manage || !uuid(input.reporter.id)) || input.impact && (input.selected?.kind !== 'holdings' || input.selected.mapStatus !== true)) throw new Error('Review the problem, current linked location and any assisted reporter before sending.');
  return { expected_revision: 0, problem, location_note, space_id: input.selected?.kind === 'places' ? input.selected.id : input.place?.id ?? null, holding_id: input.selected?.kind === 'holdings' ? input.selected.id : null, asset_impact: input.impact, urgent: input.urgent, ...(input.reporter ? { reporter_person_id: input.reporter.id } : {}) };
}
export function facilitiesAssignmentBody(repair: RepairDetail, target: 'handler' | 'verifier' | 'coordinator', person: FacilitiesChoice, note: string, revision: number, options: unknown) {
  const allowed = repair.allowed_actions[target === 'handler' ? 'assign' : target === 'verifier' ? 'assign_verifier' : 'assign_coordinator'];
  if (!uuid(repair.id) || allowed !== true || revision !== repair.revision || !positive(revision) || !facilitiesPeople(options).some(value => value.id === person.id && value.has_app_access) || note.trim().length < 3 || note.trim().length > 2000) throw new Error('Review the current repair and choose one eligible app-enabled responsible person.');
  return { expected_revision: revision, action: 'assign' as const, [`${target}_person_id`]: person.id, note: note.trim() };
}
export function facilitiesExternalBody(repair: RepairDetail, person: FacilitiesChoice, input: { revision: number; endsAt: string; instructions: string; sharedPhotoIds: string[] }, now: string, options: unknown) {
  const selected = facilitiesPeople(options).find(value => value.id === person.id);
  if (!uuid(repair.id) || repair.recovery_only || repair.external_view || repair.access_transferred || repair.can_invite_external !== true || input.revision !== repair.revision || !selected || person.revision !== selected.revision || [repair.coordinator?.id, repair.verifier.id, repair.handler.id].includes(person.id)) throw new Error('Review this exact repair and the technician’s current person record before sharing.');
  const ends = Date.parse(input.endsAt), at = Date.parse(now), instructions = input.instructions.trim();
  if (!Number.isFinite(ends) || !Number.isFinite(at) || ends <= at || ends - at > 31_536_000_000 || instructions.length < 3 || instructions.length > 2000 || input.sharedPhotoIds.length > 20 || new Set(input.sharedPhotoIds).size !== input.sharedPhotoIds.length || input.sharedPhotoIds.some(id => !uuid(id) || !repair.photos.some(photo => photo.id === id))) throw new Error('Choose an access end within one year, factual instructions and only this repair’s explicitly selected photos.');
  return { expected_revision: input.revision, person_id: person.id, expected_person_revision: selected.revision, ends_at: new Date(ends).toISOString(), instructions, shared_photo_ids: [...input.sharedPhotoIds] };
}
export function facilitiesEndBody(repair: RepairDetail, accessId: string, revision: number, note: string) {
  const access = repair.external_access;
  if (!access || access.id !== accessId || !uuid(accessId) || access.can_manage !== true || access.state === 'ended' || repair.revision !== revision || note.trim().length < 3 || note.trim().length > 2000) throw new Error('Review the exact active technician assignment and reason before ending access.');
  return { expected_revision: revision, note: note.trim() };
}
export interface FacilitiesJobContinuation { repairId: string; accessId: string; revision: number }
export function facilitiesOrdinaryReceipt(value: unknown, command: RecordedCommand) {
  const receipt = value as { state?: unknown; result?: { id?: unknown; revision?: unknown; action?: unknown; external_access_id?: unknown; access_transferred?: unknown } } | null;
  const body = JSON.parse(command.body) as { expected_revision?: number; action?: string }, base = `${command.root}/repairs/${command.sourceId}`;
  const tail = command.path.startsWith(`${base}/external-access/`) ? command.path.slice(`${base}/external-access/`.length).split('/') : [], exactAccess = tail.length === 2 && uuid(tail[0]);
  const action = command.path === `${command.root}/repairs` ? 'reported' : command.path === `${base}/actions` ? ({ accept: 'accepted', assign: 'assigned', update: 'updated', complete: 'completed', verify: 'verified', reopen: 'reopened' } as Record<string, string>)[body.action ?? ''] : command.path === `${base}/external-access` ? 'external_shared' : exactAccess && tail[1] === 'activate' ? 'external_ready' : exactAccess && tail[1] === 'end' ? 'external_ended' : null;
  const result = receipt?.result;
  if (command.domain !== 'facilities' || !uuid(command.sourceId) || !action || receipt?.state !== 'accepted' || result?.id !== command.sourceId || !Number.isSafeInteger(body.expected_revision) || result.revision !== body.expected_revision! + 1 || result.action !== action || result.access_transferred !== undefined && typeof result.access_transferred !== 'boolean') throw new Error('This exact repair command receipt is not confirmed. Keep the retained action.');
  if (action === 'external_shared' || action === 'external_ended') { if (result.external_access_id !== command.key) throw new Error('This receipt does not identify the exact technician assignment.'); }
  if (action === 'external_ready' && result.external_access_id !== command.path.split('/').at(-2)) throw new Error('This activation receipt identifies a different technician assignment.');
  return { revision: result.revision as number, action, transferred: result.access_transferred === true };
}
/** Only the exact accepted activation can advance the same user decision. */
export function facilitiesContinueJob(intent: FacilitiesJobContinuation, accepted: RecordedCommand | null, current: RepairDetail) {
  if (!accepted || accepted.domain !== 'facilities' || accepted.sourceId !== intent.repairId || accepted.phase !== 'accepted' || accepted.path !== `${accepted.root}/repairs/${intent.repairId}/external-access/${intent.accessId}/activate`) return null;
  let body: { expected_revision?: unknown; command_id?: unknown }; try { body = JSON.parse(accepted.body); } catch { return null; }
  if (body.expected_revision !== intent.revision || body.command_id !== accepted.key || current.id !== intent.repairId || current.revision !== intent.revision + 1 || !current.external_view || current.external_access?.id !== intent.accessId || current.external_access.can_activate || current.allowed_actions.accept !== true) return null;
  return { expected_revision: current.revision, action: 'accept' as RepairAction, note: '' };
}
