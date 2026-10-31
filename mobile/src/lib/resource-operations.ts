import type { InstitutionSetup, CampusResourceHolding } from '../../../packages/contracts/src/institution';
import type { ResourceCustodians, ResourceLoanDetail } from '../../../packages/contracts/src/wire/features/resources/resourceApi';
import type { RecordedCommand } from './recorded-command';
import { resourceHoldingBody } from './resources-policy';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Current Resources choices could not be verified.'); return value as Record<string, unknown>; };
const integer = (value: unknown, min: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;

export function parseResourceCustodians(value: unknown, page: number): ResourceCustodians {
  const data = object(value), pagination = object(data.pagination);
  if (typeof data.recovery !== 'boolean' || pagination.page !== page || pagination.page_size !== 10 || !integer(pagination.total, 0) || !Array.isArray(data.people) || data.people.length > 10) throw new Error('The current responsibility choices are unavailable.');
  const people = data.people.map(value => { const person = object(value); if (!uuid(person.id) || typeof person.label !== 'string' || !person.label.trim() || person.label.length > 500) throw new Error('An eligible custodian could not be verified.'); return { id: person.id, label: person.label }; });
  if (new Set(people.map(person => person.id)).size !== people.length || people.length > (pagination.total as number)) throw new Error('The responsibility choices contained conflicting identities.');
  return { people, recovery: data.recovery, pagination: { page, page_size: 10, total: pagination.total as number } };
}

export function resourceCustodyBody(loan: ResourceLoanDetail, options: ResourceCustodians, input: { selectedId: string; reason: string; revision: number }) {
  if (!uuid(loan.id) || !uuid(loan.custodian.id) || loan.can_change_custodian !== true || typeof loan.custody_recovery !== 'boolean' || options.recovery !== loan.custody_recovery || !integer(input.revision, 1) || input.revision !== loan.revision || !uuid(input.selectedId) || input.selectedId === loan.custodian.id || !options.people.some(person => person.id === input.selectedId)) throw new Error('Review this exact current loan and choose a currently eligible successor.');
  const reason = input.reason.trim(); if (reason.length < 3 || reason.length > 1000) throw new Error('Enter a responsibility-change reason of 3–1000 characters.');
  return { expected_revision: input.revision, custodian_person_id: input.selectedId, reason };
}

/** Exact acceptance can be confirmed after the original custodian loses access.
 * Refresh the queue, rather than requiring their former private loan detail. */
export function resourceAcceptedRefresh(command: RecordedCommand) {
  const loan = `${command.root}/loans/${encodeURIComponent(command.sourceId)}`;
  return command.domain === 'resources' && command.path === `${loan}/responsibility` ? { transferred: true, path: `${command.root}/workspace?view=loans&state=all&search=&page=1` } : { transferred: false, path: loan };
}

export function resourceLocationBody(current: CampusResourceHolding, values: Parameters<typeof resourceHoldingBody>[1] & { campusId: string; spaceId: string; typeId: string }, catalogue: InstitutionSetup) {
  if (current.school_id !== catalogue.school.id || !uuid(catalogue.school.id) || !catalogue.holdings.some(item => item.id === current.id && item.revision === current.revision)) throw new Error('Review the current catalogue source before changing this item.');
  const campus = catalogue.campuses.find(item => item.id === values.campusId), type = catalogue.resource_types.find(item => item.id === values.typeId);
  if (!campus || campus.school_id !== current.school_id || campus.status !== 'active' && campus.id !== current.campus_id || !type || type.school_id !== current.school_id || !type.is_active && type.id !== current.resource_type_id) throw new Error('Choose an existing campus and resource type in this institution.');
  if (values.spaceId) { const space = catalogue.spaces.find(item => item.id === values.spaceId); if (!space || space.school_id !== current.school_id || space.campus_id !== campus.id || space.status !== 'active' && space.id !== current.space_id) throw new Error('Choose a current location inside the selected campus, or Campus-wide.'); }
  const quantity = type.tracking_mode === 'individual' ? '1' : values.quantity;
  const body = resourceHoldingBody(current, { ...values, quantity });
  if (type.tracking_mode === 'individual' && !body.asset_tag) throw new Error('Individually tracked equipment needs its exact asset tag.');
  if (type.tracking_mode === 'pooled' && body.asset_tag) throw new Error('Pooled quantities cannot carry an individual asset tag. Clear the tag explicitly before saving.');
  return { ...body, campus_id: campus.id, space_id: values.spaceId || null, resource_type_id: type.id };
}
