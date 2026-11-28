import { z } from 'zod';
import type { ToolDefinition } from './providers.js';
import type { PublicWebSource } from '../campus-scene-import/scene-import.floor-plan-discovery.js';

const toolName = z.enum(['campus_search_places','campus_focus_place','open_virtual_campus','campus_open_picker',
  'open_campus_create','prepare_campus_create','open_campus_interiors','open_campus_layout']);
type ClientToolName = z.infer<typeof toolName>;
const screen = z.enum(['workspace','virtual_campus','campus_account']);
const screenTools: Record<z.infer<typeof screen>, readonly ClientToolName[]> = {
  workspace: ['open_virtual_campus','open_campus_create','open_campus_interiors','open_campus_layout'],
  virtual_campus: ['campus_search_places','campus_focus_place','campus_open_picker','open_campus_create','open_campus_interiors','open_campus_layout'],
  campus_account: ['prepare_campus_create','open_campus_interiors','open_campus_layout'],
};
const empty = z.object({}).strict();
const query = z.object({query:z.string().trim().min(1).max(120).refine(value => Array.from(value).every(character => character.charCodeAt(0) >= 32))}).strict();
export const draftCampusName = z.string().trim().min(2).max(180)
  .refine(value => !/[<>]/u.test(value) && Array.from(value).every(character => character.charCodeAt(0) >= 32));
export const indoorBuildingName = z.string().trim().min(2).max(160).refine(value=>!/[<>\p{Cc}\p{Cf}]/u.test(value));
const toolDefinitions = {
  open_virtual_campus: {schema:empty, description:'Open the current institution’s Virtual Campus screen when the user explicitly requests it.'},
  campus_open_picker: {schema:empty, description:'Open the current map’s campus picker without choosing or changing a campus.'},
  campus_search_places: {schema:query, description:'Fill the current map place search with the user’s query and show authoritative matches.'},
  campus_focus_place: {schema:query, description:'Focus an exact place match on the active Virtual Campus map. Ambiguous matches stay in search for human choice.'},
  open_campus_create: {schema:empty, description:'Open the account’s campus workspace page.'},
  prepare_campus_create: {schema:z.object({name:draftCampusName.optional()}).strict(), description:'Open and optionally prefill the campus creation form. The user confirms creation there.'},
  open_campus_layout: {schema:z.object({campus_id:z.uuid()}).strict(), description:'Open the layout editor for the authorized campus.'},
  open_campus_interiors: {schema:z.object({campus_id:z.uuid(),building_name:indoorBuildingName.optional()}).strict(), description:'Open interior mapping for the authorized campus.'},
} as const;

export const clientUiContextSchema = z.object({
  screen,
  tools:z.array(toolName).max(6),
  campus_id:z.uuid().optional(),
  last_result:z.object({tool:toolName,status:z.enum(['applied','blocked','stopped']),call_id:z.uuid().optional()}).strict().optional(),
}).strict().refine(context => new Set(context.tools).size === context.tools.length &&
  context.tools.every(tool => screenTools[context.screen].includes(tool)) && (!context.campus_id || context.screen==='virtual_campus'),
{ message:'Client tools must be uniquely advertised by the current screen.', path:['tools'] });
export type ClientUiContext = z.infer<typeof clientUiContextSchema>;

export function isClientUiTool(value: string): value is ClientToolName {
  return toolName.safeParse(value).success;
}

export function advertisedClientTools(context: ClientUiContext | undefined): ToolDefinition[] {
  return (context?.tools ?? []).filter(name => !isCampusWorkflowTool(name)).map(name => {
    const {schema,description}=toolDefinitions[name];
    return {name,description,parameters:z.toJSONSchema(schema,{io:'input'})};
  });
}

export function isCampusWorkflowTool(tool: ClientToolName) {
  return tool==='open_campus_create' || tool==='prepare_campus_create' || tool==='open_campus_interiors' || tool==='open_campus_layout';
}
export function validateClientUiCall(name: ClientToolName, input: unknown) {
  const parsed=toolDefinitions[name].schema.safeParse(input);
  return parsed.success ? {tool:name,arguments:parsed.data} : undefined;
}
export type ClientUiCall = NonNullable<ReturnType<typeof validateClientUiCall>>;
export function parseClientUiCall(context: ClientUiContext | undefined, name: ClientToolName, input: unknown) {
  return context?.tools.includes(name) ? validateClientUiCall(name,input) : undefined;
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
    context.tools.length ? 'Use the advertised controls to advance the user’s current task in the app. The user may ask to continue the same task. Call one interface tool per model response, by itself. Controls can open or prepare the app’s own screens. Say which step you are taking, without claiming it completed.' : '',
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
  | {type:'CUSTOM';name:'thatcampus.public-web-source';value:{version:1;source:PublicWebSource}}
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
  clientCalls?:readonly NonNullable<ReturnType<typeof restoreClientUiCall>>[];
  publicWebSources?:readonly PublicWebSource[];
};
export function projectAssistantAgUi({threadId,runId,status,progress,answer,evidence,actionId,clientCall,clientCalls,publicWebSources}:AgUiProjection) {
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
  for (const source of publicWebSources??[]) events.push({type:'CUSTOM',name:'thatcampus.public-web-source',value:{version:1,source}});
  if (status==='confirmation' && actionId) events.push(event('review_action',actionId));
  const calls=status==='completed' ? clientCalls ?? (clientCall ? [clientCall] : []) : [];
  for (const call of calls) {
    events.push({type:'TOOL_CALL_START',toolCallId:call.id,toolCallName:call.tool},
      {type:'TOOL_CALL_ARGS',toolCallId:call.id,delta:JSON.stringify(call.arguments)},{type:'TOOL_CALL_END',toolCallId:call.id});
  }
  events.push({type:'RUN_FINISHED',...ids,result:{status},
    ...(calls.length ? {outcome:{type:'success',pendingToolCallIds:calls.map(call=>call.id)} as const}: {})});
  return {version:'1.0' as const,events};
}
