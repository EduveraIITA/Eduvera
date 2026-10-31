import type { CapabilityReadiness, ProgressiveSetup, ProgressiveWorkspace } from '../../../packages/contracts/src/onboarding';
import { isInternalHref } from './api-policy';

export function setupDestination(value: string): string {
  if (!isInternalHref(value) || !/^\/(?:areas|work|more|onboarding)(?:\/|\?|$)/.test(value) || value.includes('#')) throw new Error('This setup destination could not be confirmed. Refresh your current setup.');
  return value;
}
export function currentSetup(workspace: ProgressiveWorkspace | undefined, setup: ProgressiveSetup | undefined, schoolId: string | null): ProgressiveSetup | null {
  return workspace?.workspace?.id && workspace.workspace.id === schoolId && setup?.school_id === schoolId ? setup : null;
}
export function selectedStartingGoals(values: readonly string[], workspace: ProgressiveWorkspace): string[] {
  const allowed = new Set<string>(workspace.catalogue.filter(item => item.selection_kind === 'goal').map(item => item.key));
  return [...new Set(values)].filter(value => allowed.has(value));
}
export function capabilityDestination(item: CapabilityReadiness): string {
  return setupDestination(item.capability === 'fees' ? item.fees_operation?.destination ?? '/areas/fees/ledger'
    : item.capability === 'resources' ? item.resources_operation?.destination ?? '/areas/resources'
    : item.capability === 'assignments' ? '/areas/messages/assignments'
    : item.status === 'working' || item.timetable_operation && item.timetable_operation.action !== 'unavailable' ? item.destination
    : `/more/setup/capabilities?task=${encodeURIComponent(item.capability)}`);
}
export function startingGoalsBody(values: readonly string[], primary: string, workspace: ProgressiveWorkspace) {
  const selected = selectedStartingGoals(values, workspace);
  if (!selected.includes(primary)) throw new Error('Choose a current starting point before continuing.');
  return { goals: [primary, ...selected.filter(value => value !== primary)], primary };
}
export function setupGateBody(gate: string, existing: string, operator: string, confirmed: boolean, data: ProgressiveSetup, actorId: string) {
  if (existing && !data.options.gates.some(item => item.id === existing)) throw new Error('Choose a current entry point.');
  if (!existing && (gate.trim().length < 2 || gate.trim().length > 160)) throw new Error('Enter an entry point name between 2 and 160 characters.');
  if (operator === 'self' && !confirmed) throw new Error('Confirm that you will operate this entry point.');
  if (operator !== 'self' && (operator === actorId || !data.options.staff.some(item => item.id === operator))) throw new Error('Choose a current staff operator.');
  return { ...(existing ? { existing_gate_id: existing } : { gate_name: gate.trim() }), operator: operator === 'self' ? { kind: 'current_user', confirm: true } : { kind: 'staff', user_id: operator } };
}

/** Provisioning owns timezone; an existing workspace's goal update owns primary.
 * Keep each request within its exact schema, including purpose-required accounts. */
export function startingGoalsRequest(values: readonly string[], primary: string, workspace: ProgressiveWorkspace, timezone: string) {
  const selection = startingGoalsBody(values, primary, workspace);
  return workspace.workspace
    ? { path: '/api/v1/onboarding/goals/', method: 'PUT' as const, body: selection }
    : { path: '/api/v1/onboarding/workspace/', method: 'POST' as const, body: { goals: selection.goals, timezone } };
}
