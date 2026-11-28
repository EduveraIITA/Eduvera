import { AG_UI_BUILDING_SELECTION_EVENT, AG_UI_WORKFLOW_STEP_EVENT } from '../../../packages/contracts/src/agent-workflow';

export const copilotToolNames = [
  'open_timetable', 'open_virtual_campus', 'campus_search_places', 'campus_focus_place', 'campus_open_picker',
  'open_campus_create', 'prepare_campus_create', 'open_campus_interiors', 'open_campus_layout',
] as const;
export type CopilotToolName = typeof copilotToolNames[number];
const screens = ['workspace', 'virtual_campus', 'campus_account'] as const;
export type CopilotScreen = typeof screens[number];
const toolPolicy: Record<CopilotToolName, { screens: readonly CopilotScreen[]; input: 'date' | 'none' | 'query' | 'name' | 'campus' | 'layout' }> = {
  open_timetable: { screens, input:'date' },
  open_virtual_campus: { screens: ['workspace'], input: 'none' },
  campus_search_places: { screens: ['virtual_campus'], input: 'query' },
  campus_focus_place: { screens: ['virtual_campus'], input: 'query' },
  campus_open_picker: { screens: ['virtual_campus'], input: 'none' },
  open_campus_create: { screens: ['workspace', 'virtual_campus'], input: 'none' },
  prepare_campus_create: { screens: ['campus_account'], input: 'name' },
  open_campus_interiors: { screens, input: 'campus' },
  open_campus_layout: { screens, input: 'layout' },
};
const routePolicy: Readonly<Record<string, { screen: CopilotScreen; identityParams: readonly string[] }>> = {
  '/more/virtual-campus': { screen: 'virtual_campus', identityParams: ['campus_id'] },
  '/more/account/campuses': { screen: 'campus_account', identityParams: [] },
};
export const copilotToolAvailableOn = (name: CopilotToolName, screen: CopilotScreen) => toolPolicy[name].screens.includes(screen);
export function copilotRouteContext(pathname: string, href: string) {
  const policy = routePolicy[pathname];
  if (!policy) return { screen: 'workspace' as const, identity: [] };
  const params = new URL(href, 'https://thatcampus.invalid').searchParams;
  return { screen: policy.screen, identity: policy.identityParams.map(name => params.get(name)) };
}

export type CopilotResult = { tool: CopilotToolName; status: 'applied' | 'blocked' | 'stopped'; call_id?: string };
export type CopilotContext = { screen: CopilotScreen; tools: CopilotToolName[]; campus_id?: string; last_result?: CopilotResult; workflow_steps?: true; building_selection?: true };
export type InteriorTarget = { campus_id: string; element_id?: string };
export type InteriorOption = { campus_id: string; element_id: string; label: string; campus_name: string };
export type InteriorCheckpoint = { step_id: string; target?: string; options: InteriorOption[] };
export type CopilotIntent = { id: string; name: CopilotToolName; args: Record<string, unknown> };

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const knownTool = (value: unknown): value is CopilotToolName =>
  typeof value === 'string' && (copilotToolNames as readonly string[]).includes(value);
const knownScreen = (value: unknown): value is CopilotScreen => screens.some(screen => screen === value);
export const copilotCallId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const buildingId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value);
/** Both app clients use the same explicit map mode to leave a retained editor. */
export function copilotPublishedMapHref(campusId?: string) {
  const params = new URLSearchParams({ view: 'map', edit: '0', indoor: '0' });
  if (copilotCallId(campusId)) params.set('campus_id', campusId);
  return `/more/virtual-campus?${params}`;
}

export function copilotIsPublishedMap(pathname: string, params: { edit?: unknown; indoor?: unknown }) {
  const editing = (value: unknown) => value === '1' || Array.isArray(value) && value.includes('1');
  return pathname === '/more/virtual-campus' && !editing(params.edit) && !editing(params.indoor);
}

export function copilotIsPublishedMapHref(pathname: string, href: string) {
  const params = new URL(href, 'https://thatcampus.invalid').searchParams;
  return copilotIsPublishedMap(pathname, { edit: params.getAll('edit'), indoor: params.getAll('indoor') });
}

const knownResult = (value: unknown): value is CopilotResult['status'] =>
  value === 'applied' || value === 'blocked' || value === 'stopped';
const cleanText = (value: unknown, min: number, max: number): value is string => typeof value === 'string' &&
  value === value.trim() && value.length >= min && value.length <= max && !/[<>]/u.test(value)
  && Array.from(value).every(character => character.charCodeAt(0) >= 32);

export function parseCopilotContext(value: unknown): CopilotContext | null {
  const input = record(value);
  if (!input || !exact(input, ['screen', 'tools', 'campus_id', 'last_result', 'workflow_steps', 'building_selection']) || !knownScreen(input.screen) || !Array.isArray(input.tools) ||
      (input.workflow_steps !== undefined && input.workflow_steps !== true) ||
      (input.building_selection !== undefined && input.building_selection !== true) ||
      input.tools.length > copilotToolNames.length || !input.tools.every(knownTool) || new Set(input.tools).size !== input.tools.length)
    return null;
  const { screen, campus_id: campusId } = input;
  if (input.tools.some(tool => !copilotToolAvailableOn(tool, screen)) ||
      (campusId !== undefined && (screen !== 'virtual_campus' || !copilotCallId(campusId)))) return null;
  const result = record(input.last_result);
  if (input.last_result !== undefined && (!result || !exact(result,['tool', 'status', 'call_id']) || !knownTool(result.tool) || !knownResult(result.status) || (result.call_id !== undefined && !copilotCallId(result.call_id)))) return null;
  return { screen, tools: [...input.tools], ...(typeof campusId === 'string' ? { campus_id: campusId } : {}),
    ...(result ? { last_result: result as CopilotResult } : {}), ...(input.workflow_steps === true ? { workflow_steps: true } : {}),
    ...(input.building_selection === true ? { building_selection: true } : {}) };
}

export function validCopilotArgs(name: CopilotToolName, value: unknown): value is Record<string, unknown> {
  const args = record(value);
  if (!args) return false;
  switch (toolPolicy[name].input) {
    case 'date': return exact(args,['date']) && typeof args.date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date) && Number.isFinite(Date.parse(args.date)) && new Date(args.date).toISOString().slice(0,10)===args.date;
    case 'none': return Object.keys(args).length === 0;
    case 'query': return exact(args, ['query']) && cleanText(args.query, 1, 120);
    case 'name': return exact(args, ['name']) && (args.name === undefined || cleanText(args.name, 2, 180));
    case 'layout': return exact(args, ['campus_id']) && copilotCallId(args.campus_id);
    case 'campus': return exact(args,['campus_id','building_name','building_id']) && copilotCallId(args.campus_id) &&
      (args.building_name===undefined || cleanText(args.building_name,2,160)) &&
      (args.building_id===undefined || buildingId(args.building_id));
  }
}

export function validInteriorTarget(value: unknown): value is InteriorTarget {
  const selection = record(value);
  return !!selection && exact(selection, ['campus_id', 'element_id']) && copilotCallId(selection.campus_id)
    && (selection.element_id === undefined || buildingId(selection.element_id));
}

function readInteriorCheckpoint(value: unknown): InteriorCheckpoint | null {
  const step = record(value);
  if (!step || !exact(step, ['version', 'step_id', 'target', 'options']) || step.version !== 1 || !copilotCallId(step.step_id)
      || (step.target !== undefined && !cleanText(step.target, 1, 160)) || !Array.isArray(step.options) || step.options.length > 8) return null;
  const options: InteriorOption[] = [];
  for (const value of step.options) {
    const entry = record(value);
    if (!entry || !exact(entry, ['campus_id', 'element_id', 'label', 'campus_name']) || !copilotCallId(entry.campus_id)
        || !buildingId(entry.element_id) || !cleanText(entry.label, 1, 160) || !cleanText(entry.campus_name, 1, 180)
        || options.some(option => option.campus_id === entry.campus_id && option.element_id === entry.element_id)) return null;
    options.push({ campus_id: entry.campus_id, element_id: entry.element_id, label: entry.label, campus_name: entry.campus_name });
  }
  return { step_id: step.step_id, ...(typeof step.target === 'string' ? { target: step.target } : {}), options };
}

/** Only app-owned transitions may open a control that wasn't advertised on
 * the original route. That control is still resolved from the mounted owner. */
const continuations: Partial<Record<CopilotToolName, readonly CopilotToolName[]>> = {
  open_campus_create: ['prepare_campus_create'],
};
export function copilotCanContinue(previous: CopilotToolName, next: CopilotToolName) {
  return continuations[previous]?.includes(next) === true;
}

/** A complete ordered batch is required before any action can affect the workspace. */
export function readCopilotBatch(value: unknown, threadId: string, runId: string) {
  const frame = record(value);
  if (!frame || frame.version !== '1.0' || !Array.isArray(frame.events) || frame.events.length > 64) return null;
  const rows = frame.events.map(record);
  if (rows.some(row => !row)) return null;
  const first = rows[0], last = rows.at(-1);
  if (first?.type !== 'RUN_STARTED' || first.threadId !== threadId || first.runId !== runId ||
      last?.type !== 'RUN_FINISHED' || last.threadId !== threadId || last.runId !== runId ||
      (last.outcome !== undefined && record(last.outcome)?.type !== 'success')) return null;
  let call: { id: string; name: CopilotToolName; payload: string } | undefined;
  let workflowCallId: string | undefined;
  let interiorCheckpoint: InteriorCheckpoint | null = null;
  const plan: CopilotIntent[] = [];
  const receipts = new Map<string, CopilotResult['status']>();
  for (const row of rows.slice(1, -1)) {
    if (!row || typeof row.type !== 'string') return null;
    if (row.type === 'RUN_STARTED' || row.type === 'RUN_FINISHED' || row.type === 'RUN_ERROR') return null;
    if (row.type === 'CUSTOM' && row.name === AG_UI_WORKFLOW_STEP_EVENT) {
      const step = record(row.value);
      if (workflowCallId || !step || !exact(step, ['version', 'call_id']) || step.version !== 1 || !copilotCallId(step.call_id)) return null;
      workflowCallId = step.call_id;
    }
    if (row.type === 'CUSTOM' && row.name === AG_UI_BUILDING_SELECTION_EVENT) {
      if (interiorCheckpoint) return null;
      interiorCheckpoint = readInteriorCheckpoint(row.value);
      if (!interiorCheckpoint) return null;
    }
    if (row.type === 'TOOL_CALL_RESULT') {
      if (call || plan.length || receipts.size >= 2 || !copilotCallId(row.toolCallId) || receipts.has(row.toolCallId) ||
          row.role !== 'tool' || row.messageId !== `${row.toolCallId}:result` ||
          typeof row.content !== 'string' || row.content.length > 128) return null;
      let result: unknown;
      try { result = JSON.parse(row.content); } catch { return null; }
      const outcome = record(result);
      if (!outcome || !exact(outcome, ['status']) || !knownResult(outcome.status)) return null;
      receipts.set(row.toolCallId, outcome.status);
      continue;
    }
    if (!row.type.startsWith('TOOL_CALL_')) continue;
    if (row.type === 'TOOL_CALL_START' && !call && plan.length < 3 && typeof row.toolCallId === 'string' &&
        /^[A-Za-z0-9_-]{1,128}$/.test(row.toolCallId) && !plan.some(step=>step.id===row.toolCallId) && knownTool(row.toolCallName)) {
      call = { id: row.toolCallId, name: row.toolCallName, payload: '' };
    } else if (row.type === 'TOOL_CALL_ARGS' && call && row.toolCallId === call.id && typeof row.delta === 'string') {
      call.payload += row.delta;
      if (call.payload.length > 1024) return null;
    } else if (row.type === 'TOOL_CALL_END' && call && row.toolCallId === call.id) {
      let args: unknown;
      try { args = JSON.parse(call.payload); } catch { return null; }
      if (!validCopilotArgs(call.name, args)) return null;
      plan.push({ id:call.id, name:call.name, args });
      call = undefined;
    } else return null;
  }
  if (call || plan.some(intent=>receipts.has(intent.id))) return null;
  const pendingIds = record(last.outcome)?.pendingToolCallIds;
  if (pendingIds !== undefined && (!Array.isArray(pendingIds) || pendingIds.length !== plan.length ||
      pendingIds.some((id,index)=>id!==plan[index]?.id))) return null;
  if (workflowCallId && (plan.length !== 1 || plan[0]?.id !== workflowCallId || !Array.isArray(pendingIds) ||
      (!['open_campus_create', 'prepare_campus_create', 'open_campus_interiors'].includes(plan[0].name)))) return null;
  if (interiorCheckpoint && (workflowCallId || receipts.size || plan.length > 1 ||
      plan.some(intent => intent.name !== 'open_virtual_campus' && intent.name !== 'campus_open_picker') ||
      plan.some(intent => intent.id === interiorCheckpoint.step_id))) return null;
  if (!plan.every((step,index)=>index===0 || copilotCanContinue(plan[index-1]!.name,step.name))) return null;
  return { plan, workflowCallId, interiorCheckpoint, receipts, status: record(last.result)?.status };
}

export function readCopilotPlan(value: unknown, threadId: string, runId: string): CopilotIntent[] | null {
  const batch = readCopilotBatch(value, threadId, runId);
  return batch?.plan.length ? batch.plan : null;
}

/** A receipt reply can continue the exact run once, through a declared route transition. */
export function readCopilotWorkflowReply(value: unknown, threadId: string, runId: string, previous: CopilotIntent) {
  const batch = readCopilotBatch(value, threadId, runId);
  if (!batch || batch.interiorCheckpoint) return null;
  const next = batch.plan[0];
  const status = batch.receipts.get(previous.id);
  if (!next) return batch.status === 'completed' ? { kind: 'finished' as const, status } : null;
  return batch.workflowCallId === next.id && batch.receipts.size === 1 && status === 'applied' && next.id !== previous.id
    && copilotCanContinue(previous.name, next.name) ? { kind: 'step' as const, intent: next } : null;
}

/** Human input may unlock one exact registered editor on the same owned run. */
export function readCopilotBuildingSelectionReply(
  value: unknown, threadId: string, runId: string, stepId: string, selection: InteriorTarget,
) {
  const batch = readCopilotBatch(value, threadId, runId);
  if (!batch) return null;
  const checkpoint = batch.interiorCheckpoint;
  if (checkpoint) return !batch.plan.length && checkpoint.step_id === stepId
    && checkpoint.options.every(option => option.campus_id === selection.campus_id)
    ? { kind: 'wait' as const, checkpoint } : null;
  const next = batch.plan[0];
  if (!next) return batch.status === 'completed' && batch.receipts.size === 1 && batch.receipts.has(stepId)
    ? { kind: 'finished' as const } : null;
  return batch.workflowCallId === next.id && next.name === 'open_campus_interiors'
    && batch.receipts.size === 1 && batch.receipts.get(stepId) === 'applied'
    && next.args.campus_id === selection.campus_id && buildingId(next.args.building_id)
    && (selection.element_id === undefined || selection.element_id === next.args.building_id)
    ? { kind: 'step' as const, batch } : null;
}
