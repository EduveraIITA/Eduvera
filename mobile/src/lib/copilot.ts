export const copilotToolNames = [
  'open_virtual_campus', 'campus_search_places', 'campus_focus_place', 'campus_open_picker',
  'open_campus_create', 'prepare_campus_create', 'open_campus_interiors',
] as const;
export type CopilotToolName = typeof copilotToolNames[number];
const screens = ['workspace', 'virtual_campus', 'campus_account'] as const;
export type CopilotScreen = typeof screens[number];
const toolPolicy: Record<CopilotToolName, { screens: readonly CopilotScreen[]; input: 'none' | 'query' | 'name' | 'campus' }> = {
  open_virtual_campus: { screens: ['workspace'], input: 'none' },
  campus_search_places: { screens: ['virtual_campus'], input: 'query' },
  campus_focus_place: { screens: ['virtual_campus'], input: 'query' },
  campus_open_picker: { screens: ['virtual_campus'], input: 'none' },
  open_campus_create: { screens: ['workspace', 'virtual_campus'], input: 'none' },
  prepare_campus_create: { screens: ['campus_account'], input: 'name' },
  open_campus_interiors: { screens, input: 'campus' },
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
export type CopilotContext = { screen: CopilotScreen; tools: CopilotToolName[]; campus_id?: string; last_result?: CopilotResult };
export type CopilotIntent = { id: string; name: CopilotToolName; args: Record<string, unknown> };

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const knownTool = (value: unknown): value is CopilotToolName =>
  typeof value === 'string' && (copilotToolNames as readonly string[]).includes(value);
const knownScreen = (value: unknown): value is CopilotScreen => screens.some(screen => screen === value);
export const copilotCallId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const knownResult = (value: unknown): value is CopilotResult['status'] =>
  value === 'applied' || value === 'blocked' || value === 'stopped';
const cleanText = (value: unknown, min: number, max: number): value is string => typeof value === 'string' &&
  value === value.trim() && value.length >= min && value.length <= max && !/[<>]/u.test(value)
  && Array.from(value).every(character => character.charCodeAt(0) >= 32);

export function parseCopilotContext(value: unknown): CopilotContext | null {
  const input = record(value);
  if (!input || !exact(input, ['screen', 'tools', 'campus_id', 'last_result']) || !knownScreen(input.screen) || !Array.isArray(input.tools) ||
      input.tools.length > copilotToolNames.length || !input.tools.every(knownTool) || new Set(input.tools).size !== input.tools.length)
    return null;
  const { screen, campus_id: campusId } = input;
  if (input.tools.some(tool => !copilotToolAvailableOn(tool, screen)) ||
      (campusId !== undefined && (screen !== 'virtual_campus' || !copilotCallId(campusId)))) return null;
  const result = record(input.last_result);
  if (input.last_result !== undefined && (!result || !exact(result,['tool', 'status', 'call_id']) || !knownTool(result.tool) || !knownResult(result.status) || (result.call_id !== undefined && !copilotCallId(result.call_id)))) return null;
  return { screen, tools: [...input.tools], ...(typeof campusId === 'string' ? { campus_id: campusId } : {}), ...(result ? { last_result: result as CopilotResult } : {}) };
}

export function validCopilotArgs(name: CopilotToolName, value: unknown): value is Record<string, unknown> {
  const args = record(value);
  if (!args) return false;
  switch (toolPolicy[name].input) {
    case 'none': return Object.keys(args).length === 0;
    case 'query': return exact(args, ['query']) && cleanText(args.query, 1, 120);
    case 'name': return exact(args, ['name']) && (args.name === undefined || cleanText(args.name, 2, 180));
    case 'campus': return exact(args,['campus_id','building_name']) && copilotCallId(args.campus_id) && (args.building_name===undefined||cleanText(args.building_name,2,160));
  }
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
export function readCopilotPlan(value: unknown, threadId: string, runId: string): CopilotIntent[] | null {
  const frame = record(value);
  if (!frame || frame.version !== '1.0' || !Array.isArray(frame.events) || frame.events.length > 64) return null;
  const rows = frame.events.map(record);
  if (rows.some(row => !row)) return null;
  const first = rows[0], last = rows.at(-1);
  if (first?.type !== 'RUN_STARTED' || first.threadId !== threadId || first.runId !== runId ||
      last?.type !== 'RUN_FINISHED' || last.threadId !== threadId || last.runId !== runId ||
      (last.outcome !== undefined && record(last.outcome)?.type !== 'success')) return null;
  let call: { id: string; name: CopilotToolName; payload: string } | undefined;
  const plan: CopilotIntent[] = [];
  for (const row of rows.slice(1, -1)) {
    if (!row || typeof row.type !== 'string') return null;
    if (row.type === 'RUN_STARTED' || row.type === 'RUN_FINISHED' || row.type === 'RUN_ERROR') return null;
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
  if (call || !plan.length) return null;
  const pendingIds = record(last.outcome)?.pendingToolCallIds;
  if (pendingIds !== undefined && (!Array.isArray(pendingIds) || pendingIds.length !== plan.length ||
      pendingIds.some((id,index)=>id!==plan[index]?.id))) return null;
  return plan.every((step,index)=>index===0 || copilotCanContinue(plan[index-1]!.name,step.name)) ? plan : null;
}
