import { z } from 'zod';
import type { ToolDefinition } from './providers.js';

const toolName = z.enum(['campus_search_places','campus_focus_place','open_virtual_campus','campus_open_picker']);
type ClientToolName = z.infer<typeof toolName>;
const screenTools: Record<'workspace'|'virtual_campus', readonly ClientToolName[]> = {
  workspace: ['open_virtual_campus'],
  virtual_campus: ['campus_search_places','campus_focus_place','campus_open_picker'],
};
const empty = z.object({}).strict();
const query = z.object({query:z.string().trim().min(1).max(120).refine(value => Array.from(value).every(character => character.charCodeAt(0) >= 32))}).strict();
const toolDefinitions = {
  open_virtual_campus: {schema:empty, description:'Open the current institution’s Virtual Campus screen when the user explicitly requests it.'},
  campus_open_picker: {schema:empty, description:'Open the current map’s campus picker without choosing or changing a campus.'},
  campus_search_places: {schema:query, description:'Fill the current map place search with the user’s query and show authoritative matches.'},
  campus_focus_place: {schema:query, description:'Focus an exact place match on the active Virtual Campus map. Ambiguous matches stay in search for human choice.'},
} as const;

export const clientUiContextSchema = z.object({
  screen:z.enum(['workspace','virtual_campus']),
  tools:z.array(toolName).max(3),
  last_result:z.object({tool:toolName,status:z.enum(['applied','blocked','stopped']),call_id:z.uuid().optional()}).strict().optional(),
}).strict().refine(context => new Set(context.tools).size === context.tools.length &&
  context.tools.every(tool => screenTools[context.screen].includes(tool)),
{ message:'Client tools must be uniquely advertised by the current screen.', path:['tools'] });
export type ClientUiContext = z.infer<typeof clientUiContextSchema>;

export function isClientUiTool(value: string): value is ClientToolName {
  return toolName.safeParse(value).success;
}

export function advertisedClientTools(context: ClientUiContext | undefined): ToolDefinition[] {
  return (context?.tools ?? []).map(name => {
    const {schema,description}=toolDefinitions[name];
    return {name,description,parameters:z.toJSONSchema(schema,{io:'input'})};
  });
}

export function parseClientUiCall(context: ClientUiContext | undefined, name: ClientToolName, input: unknown) {
  if (!context?.tools.includes(name)) return undefined;
  const parsed=toolDefinitions[name].schema.safeParse(input);
  return parsed.success ? {tool:name,arguments:parsed.data} : undefined;
}

export function restoreClientUiCall(id: string, input: unknown) {
  const parsed=z.object({tool:toolName,arguments:z.unknown()}).strict().safeParse(input);
  if (!parsed.success) return undefined;
  const args=toolDefinitions[parsed.data.tool].schema.safeParse(parsed.data.arguments);
  return args.success ? {id,tool:parsed.data.tool,arguments:args.data} : undefined;
}

export function clientUiPrompt(context: ClientUiContext | undefined) {
  if (!context) return '';
  const result=context.last_result;
  return [
    context.tools.length ? 'The app advertised the screen controls listed in your tools. Use at most one control, on its own, when the newest user message explicitly asks you to use it. Never use a prior message as permission. These tools only change the visible interface. The app checks the actual screen and permissions before any effect; do not claim an effect happened.' : '',
    result ? `The client reported the previous control ${result.tool} as ${result.status}. This is a display status, not evidence of campus records or authorization. Do not repeat a blocked or stopped control unless the user asks again.` : '',
  ].filter(Boolean).join('\n');
}

export const CLIENT_UI_CONTEXT_STEP = 'assistant_client_ui_context';
export const CLIENT_UI_CALL_STEP = 'assistant_client_ui_call';

type RunStatus = 'running'|'completed'|'confirmation'|'failed'|'cancelled';
type UiIntentKind = 'view_source'|'view_report'|'review_action';
export type AssistantAgUiEvent =
  | {type:'RUN_STARTED';threadId:string;runId:string;protocolVersion:'1.0'}
  | {type:'STATE_SNAPSHOT';snapshot:{status:RunStatus;progress:string}}
  | {type:'TEXT_MESSAGE_START';messageId:string;role:'assistant'}
  | {type:'TEXT_MESSAGE_CONTENT';messageId:string;delta:string}
  | {type:'TEXT_MESSAGE_END';messageId:string}
  | {type:'CUSTOM';name:'thatcampus.ui-intent';value:{version:1;kind:UiIntentKind;subjectId:string}}
  | {type:'TOOL_CALL_START';toolCallId:string;toolCallName:ClientToolName}
  | {type:'TOOL_CALL_ARGS';toolCallId:string;delta:string}
  | {type:'TOOL_CALL_END';toolCallId:string}
  | {type:'RUN_FINISHED';threadId:string;runId:string;result?:{status:'completed'|'confirmation'};
    outcome?:{type:'cancelled'}|{type:'success';pendingToolCallIds:string[]}}
  | {type:'RUN_ERROR';message:string;code:'assistant_failed'};

type AgUiProjection = {
  threadId:string; runId:string; status:RunStatus; progress:string; answer:string;
  evidence:readonly {id:string;chart?:unknown}[];
  actionId?:string; clientCall?:NonNullable<ReturnType<typeof restoreClientUiCall>>;
};
export function projectAssistantAgUi({threadId,runId,status,progress,answer,evidence,actionId,clientCall}:AgUiProjection) {
  const ids={threadId,runId}, messageId=`${runId}:assistant`;
  const event=(kind:UiIntentKind,subjectId:string):AssistantAgUiEvent => ({type:'CUSTOM', name:'thatcampus.ui-intent', value:{version:1,kind,subjectId}});
  const events:AssistantAgUiEvent[]=[
    {type:'RUN_STARTED',...ids,protocolVersion:'1.0'},
    {type:'STATE_SNAPSHOT',snapshot:{status,progress}},
  ];
  if (status==='running') return {version:'1.0' as const,events};
  if (answer) events.push({type:'TEXT_MESSAGE_START',messageId,role:'assistant'},
    {type:'TEXT_MESSAGE_CONTENT',messageId,delta:answer},{type:'TEXT_MESSAGE_END',messageId});
  if (status==='failed') {
    events.push({type:'RUN_ERROR',message:'The Assistant request did not complete.',code:'assistant_failed'});
    return {version:'1.0' as const,events};
  }
  if (status==='cancelled') {
    events.push({type:'RUN_FINISHED',...ids,outcome:{type:'cancelled'}});
    return {version:'1.0' as const,events};
  }
  for (const source of evidence) events.push(event(source.chart?'view_report':'view_source',source.id));
  if (status==='confirmation' && actionId) events.push(event('review_action',actionId));
  if (status==='completed' && clientCall) {
    const toolCallId=clientCall.id;
    events.push({type:'TOOL_CALL_START',toolCallId,toolCallName:clientCall.tool},
      {type:'TOOL_CALL_ARGS',toolCallId,delta:JSON.stringify(clientCall.arguments)},{type:'TOOL_CALL_END',toolCallId});
  }
  events.push({type:'RUN_FINISHED',...ids,result:{status},
    ...(status==='completed' && clientCall ? {outcome:{type:'success',pendingToolCallIds:[clientCall.id]} as const}: {})});
  return {version:'1.0' as const,events};
}
