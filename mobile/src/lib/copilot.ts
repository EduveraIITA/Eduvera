export const copilotToolNames = ['open_virtual_campus', 'campus_search_places', 'campus_focus_place', 'campus_open_picker'] as const;
export type CopilotToolName = typeof copilotToolNames[number];
export type CopilotScreen = 'virtual_campus' | 'workspace';
const toolPolicy: Record<CopilotToolName, { screen: CopilotScreen; input: 'none' | 'query' }> = {
  open_virtual_campus: { screen: 'workspace', input: 'none' },
  campus_search_places: { screen: 'virtual_campus', input: 'query' },
  campus_focus_place: { screen: 'virtual_campus', input: 'query' },
  campus_open_picker: { screen: 'virtual_campus', input: 'none' },
};
const routePolicy: Readonly<Record<string, { screen: CopilotScreen; identityParams: readonly string[] }>> = {
  '/more/virtual-campus': { screen: 'virtual_campus', identityParams: ['campus_id'] },
};
export const copilotToolScreen = (name: CopilotToolName) => toolPolicy[name].screen;
export function copilotRouteContext(pathname: string, href: string) {
  const policy = routePolicy[pathname];
  if (!policy) return { screen: 'workspace' as const, identity: [] };
  const params = new URL(href, 'https://thatcampus.invalid').searchParams;
  return { screen: policy.screen, identity: policy.identityParams.map(name => params.get(name)) };
}

export type CopilotResult = { tool: CopilotToolName; status: 'applied' | 'blocked' | 'stopped'; call_id?: string };
export type CopilotContext = { screen: CopilotScreen; tools: CopilotToolName[]; last_result?: CopilotResult };
export type CopilotIntent = { id: string; name: CopilotToolName; args: Record<string, unknown> };

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const knownTool = (value: unknown): value is CopilotToolName =>
  typeof value === 'string' && (copilotToolNames as readonly string[]).includes(value);
export const copilotCallId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const knownResult = (value: unknown): value is CopilotResult['status'] =>
  value === 'applied' || value === 'blocked' || value === 'stopped';

export function parseCopilotContext(value: unknown): CopilotContext | null {
  const input = record(value);
  if (!input || !exact(input, ['screen', 'tools', 'last_result']) ||
      (input.screen !== 'workspace' && input.screen !== 'virtual_campus') || !Array.isArray(input.tools) ||
      input.tools.length > copilotToolNames.length || !input.tools.every(knownTool) || new Set(input.tools).size !== input.tools.length)
    return null;
  const screen = input.screen;
  if (input.tools.some(tool => copilotToolScreen(tool) !== screen)) return null;
  const result = record(input.last_result);
  if (input.last_result !== undefined && (!result || !exact(result,['tool', 'status', 'call_id']) || !knownTool(result.tool) || !knownResult(result.status) || (result.call_id !== undefined && !copilotCallId(result.call_id)))) return null;
  return { screen, tools: [...input.tools], ...(result ? { last_result: result as CopilotResult } : {}) };
}

export function validCopilotArgs(name: CopilotToolName, value: unknown): value is Record<string, unknown> {
  const args = record(value);
  if (!args) return false;
  if (toolPolicy[name].input === 'none') return Object.keys(args).length === 0;
  return exact(args, ['query']) && typeof args.query === 'string' && args.query === args.query.trim() &&
    args.query.length >= 1 && args.query.length <= 120 && !/[<>]/u.test(args.query)
    && Array.from(args.query).every(character => character.charCodeAt(0) >= 32);
}

/** App binding executes one complete client tool from an exact owned run. It is
 * independent of the transport and refuses unknown or incomplete tool calls. */
export function readCopilotIntent(value: unknown, threadId: string, runId: string): CopilotIntent | null {
  const frame = record(value);
  if (!frame || frame.version !== '1.0' || !Array.isArray(frame.events) || frame.events.length > 64) return null;
  const rows = frame.events.map(record);
  if (rows.some(row => !row)) return null;
  const first = rows[0], last = rows.at(-1);
  if (first?.type !== 'RUN_STARTED' || first.threadId !== threadId || first.runId !== runId ||
      last?.type !== 'RUN_FINISHED' || last.threadId !== threadId || last.runId !== runId ||
      (last.outcome !== undefined && record(last.outcome)?.type !== 'success')) return null;
  let call: { id: string; name: CopilotToolName; payload: string; complete: boolean } | undefined;
  for (const row of rows.slice(1, -1)) {
    if (!row || typeof row.type !== 'string') return null;
    if (row.type === 'RUN_STARTED' || row.type === 'RUN_FINISHED' || row.type === 'RUN_ERROR') return null;
    if (!row.type.startsWith('TOOL_CALL_')) continue;
    if (row.type === 'TOOL_CALL_START' && !call && typeof row.toolCallId === 'string' &&
        /^[A-Za-z0-9_-]{1,128}$/.test(row.toolCallId) && knownTool(row.toolCallName)) {
      call = { id: row.toolCallId, name: row.toolCallName, payload: '', complete: false };
    } else if (row.type === 'TOOL_CALL_ARGS' && call && !call.complete && row.toolCallId === call.id && typeof row.delta === 'string') {
      call.payload += row.delta;
      if (call.payload.length > 1024) return null;
    } else if (row.type === 'TOOL_CALL_END' && call && !call.complete && row.toolCallId === call.id) {
      call.complete = true;
    } else return null;
  }
  if (!call?.complete) return null;
  const pendingIds = record(last.outcome)?.pendingToolCallIds;
  if (pendingIds !== undefined && (!Array.isArray(pendingIds) || pendingIds.length !== 1 || pendingIds[0] !== call.id)) return null;
  let args: unknown;
  try { args = JSON.parse(call.payload); } catch { return null; }
  return validCopilotArgs(call.name, args) ? { id: call.id, name: call.name, args } : null;
}
