import type { CampusResourceHolding, CampusResourceType } from '../../../packages/contracts/src/institution';
import type { ResourceCondition, ResourceItemCreation, ResourceLoanDetail } from '../../../packages/contracts/src/wire/features/resources/resourceApi';
import type { RecordedCommand } from './recorded-command';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const conditions = ['usable', 'damaged', 'held'];
const categories = ['computer', 'display', 'tablet', 'lab_equipment', 'furniture', 'vehicle', 'network', 'safety', 'other'];
export type ResourceReceived = Record<string, { quantity: string; condition: ResourceCondition }>;

export function currentResourceReturns(loan: ResourceLoanDetail) {
  const replaced = new Set(loan.history.flatMap(receipt => receipt.supersedes_receipt_id ? [receipt.supersedes_receipt_id] : []));
  return loan.history.filter(receipt => ['return_recorded', 'return_corrected'].includes(receipt.action) && !replaced.has(receipt.id));
}
export function resourceReceivableParts(loan: ResourceLoanDetail, supersedes = '') {
  const original = supersedes ? currentResourceReturns(loan).find(receipt => receipt.id === supersedes) : undefined;
  if (supersedes && !original) throw new Error('That return is no longer current. Choose its current receipt before continuing.');
  return loan.parts.map(part => ({ ...part, receivable_quantity: part.outstanding_quantity + (original?.parts.find(entry => entry.part_id === part.id)?.quantity ?? 0) })).filter(part => part.receivable_quantity > 0);
}
export function resourceReturnBody(loan: ResourceLoanDetail, input: { correction: boolean; supersedes: string; observedAt: string; reason: string; received: ResourceReceived }, now: string) {
  if (!loan.can_record_return || !Number.isSafeInteger(loan.revision) || loan.revision < 1) throw new Error('Your current responsibility does not allow recording this return.');
  if (input.supersedes && (!input.correction || !uuid(input.supersedes))) throw new Error('Choose the exact return being corrected.');
  const available = resourceReceivableParts(loan, input.supersedes);
  const parts = Object.entries(input.received).map(([part_id, part]) => {
    const source = available.find(value => value.id === part_id);
    if (!source || !/^\d+$/.test(part.quantity) || !Number.isSafeInteger(Number(part.quantity)) || Number(part.quantity) < 1 || Number(part.quantity) > Math.min(100, source.receivable_quantity) || !conditions.includes(part.condition)) throw new Error('Choose the actual whole quantities received. Other parts stay out.');
    return { part_id, quantity: Number(part.quantity), condition: part.condition };
  });
  if (!parts.length && !(input.correction && input.supersedes)) throw new Error('Choose what you actually received.');
  const observed = Date.parse(input.observedAt), current = Date.parse(now);
  if (!Number.isFinite(observed) || !Number.isFinite(current) || observed < Date.parse(loan.issued_at) || observed > current) throw new Error('Receipt time must be between issue and the current campus time.');
  const reason = input.reason.trim();
  if (reason.length > 1000 || input.correction && reason.length < 3) throw new Error('Give a correction reason from 3 to 1000 characters.');
  return { expected_revision: loan.revision, observed_at: new Date(observed).toISOString(), reason, correction: input.correction, ...(input.supersedes ? { supersedes_receipt_id: input.supersedes } : {}), parts };
}

export function resourceItemBody(name: string, quantity: string, tag: string, campusId: string, typeId = '') {
  const count = Number(quantity), cleanName = name.trim(), cleanTag = tag.trim();
  if (cleanName.length < 2 || cleanName.length > 160 || !/^\d+$/.test(quantity) || !Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error('Use an item name and a whole quantity from 1 to 100.');
  if (!uuid(campusId) || typeId && !uuid(typeId)) throw new Error('Choose an existing campus and resource type.');
  if (cleanTag.length > (count > 1 ? 76 : 80)) throw new Error(`Use at most ${count > 1 ? 76 : 80} characters for the ${count > 1 ? 'tag prefix' : 'asset tag'}.`);
  return { name: cleanName, quantity: count, ...(cleanTag ? { asset_tag: cleanTag } : {}), campus_id: campusId, ...(typeId ? { resource_type_id: typeId } : {}) };
}

type ResourceItemDigest = (input: string) => Promise<string>;
const nativeItemDigest: ResourceItemDigest = async input => {
  const Crypto = await import('expo-crypto');
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input);
};
/** The topology owner's ordered UUIDv8 identities, including every recovered copy. */
export async function resourceItemCopyIds(commandId: string, quantity: number, digest: ResourceItemDigest = nativeItemDigest) {
  if (!uuid(commandId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) throw new Error('The exact item batch identity is invalid.');
  return Promise.all(Array.from({ length: quantity }, async (_, index) => {
    if (index === 0) return commandId;
    const hash = await digest(`campus-topology:lending-copy:${commandId}:${index + 1}`);
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('The item copy identity could not be verified.');
    const hex = `${hash.slice(0, 12)}8${hash.slice(13, 16)}${((parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16)}${hash.slice(17, 32)}`;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }));
}

/** An exact replay proves the original command; its returned inventory is current. */
export async function acceptedResourceItemBatch(command: RecordedCommand, result: unknown, digest: ResourceItemDigest = nativeItemDigest): Promise<boolean> {
  try {
    if (command.domain !== 'resources' || command.kind !== 'item' || command.path !== `${command.root}/items` || command.sourceId !== command.key) return false;
    const body = JSON.parse(command.body) as ReturnType<typeof resourceItemBody> & { command_id: string }, value = result as ResourceItemCreation;
    const quantity = body.quantity ?? 1, copies = value?.created_items;
    if (body.command_id !== command.key || value?.id !== command.key || value.quantity !== quantity || !Array.isArray(copies) || copies.length !== quantity || copies[0]?.id !== command.key || new Set(copies.map(copy => copy.id)).size !== quantity) return false;
    const expectedIds = await resourceItemCopyIds(command.key, quantity, digest);
    // Topology checks the original payload hash and every child receipt before
    // returning these exact IDs. Names, tags and locations can change later.
    return copies.every((copy, index) => copy.id === expectedIds[index] && uuid(copy.campus_id)
      && typeof copy.name === 'string' && copy.name.trim().length >= 2 && copy.name.length <= 160
      && typeof copy.campus_name === 'string' && copy.campus_name.trim().length > 0
      && ['individual', 'pooled'].includes(copy.tracking_mode) && ['available', 'unavailable', 'retired'].includes(copy.state)
      && Number.isSafeInteger(copy.revision) && copy.revision > 0
      && (copy.asset_tag === null || typeof copy.asset_tag === 'string' && copy.asset_tag.length <= 80)
      && typeof copy.available === 'boolean' && (copy.available ? copy.unavailable_reason === null : typeof copy.unavailable_reason === 'string' && copy.unavailable_reason.length > 0)
      && (copy.active_loan_id === null || uuid(copy.active_loan_id)));
  } catch { return false; }
}

export function resourceTypeBody(input: { code: string; name: string; category: string; tracking_mode: string; unit_label: string; is_active: boolean }, current?: CampusResourceType) {
  const code = input.code.trim().toUpperCase(), name = input.name.trim(), unit = input.unit_label.trim();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code) || name.length < 2 || name.length > 120 || unit.length < 1 || unit.length > 32 || !categories.includes(input.category) || !['pooled', 'individual'].includes(input.tracking_mode)) throw new Error('Review the type code, name, category, tracking and unit label.');
  if (current && (!uuid(current.id) || !Number.isSafeInteger(current.revision) || current.revision < 1)) throw new Error('The current resource type could not be confirmed.');
  return { ...input, code, name, unit_label: unit, ...(current ? { expected_revision: current.revision } : {}) };
}
export function resourceHoldingBody(current: CampusResourceHolding, values: { name: string; asset_tag: string; quantity: string; state: string; notes: string }) {
  const name = values.name.trim(), tag = values.asset_tag.trim();
  if (!uuid(current.id) || !Number.isSafeInteger(current.revision) || current.revision < 1 || name.length < 2 || name.length > 160 || tag.length > 80 || !/^\d+$/.test(values.quantity) || Number(values.quantity) < 1 || Number(values.quantity) > 1000000 || !['available', 'unavailable', 'retired'].includes(values.state) || values.notes.trim().length > 500) throw new Error('Review the item name, quantity, tag, status and notes.');
  return { campus_id: current.campus_id, space_id: current.space_id, resource_type_id: current.resource_type_id, name, quantity: Number(values.quantity), asset_tag: tag || null, state: values.state, notes: values.notes.trim(), expected_revision: current.revision };
}

export function confirmedResourceSetupChange(value: unknown, schoolId: string, sourceId?: string) {
  const row = value as { id?: string; school_id?: string; revision?: number } | null;
  if (!row || !uuid(row.id) || row.school_id !== schoolId || sourceId && row.id !== sourceId || !Number.isSafeInteger(row.revision) || row.revision! < 1) throw new Error('The owning catalogue did not confirm this exact campus record. Its action remains retained.');
  return row;
}
