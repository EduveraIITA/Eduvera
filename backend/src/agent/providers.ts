import { z } from 'zod';
import { vertexAccessToken, vertexSettings } from './vertex-auth.js';
import { assertAgentEnabled } from './limits.js';
import { ModelFailure, type ModelDiagnostic } from './model-errors.js';
import { ApiError, GoogleGenAI, FunctionCallingConfigMode, ThinkingLevel, type Content, type GenerateContentConfig, type Tool } from '@google/genai';
import pRetry from 'p-retry';

export type ModelBudget = (inputTokens: number, maxOutputTokens: number) => Promise<void>;

export interface ToolDefinition { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolCall { id: string; name: string; arguments: Record<string, unknown> }
export interface ModelMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; calls?: ToolCall[]; callId?: string; name?: string }
export interface ModelReply { text: string; calls: ToolCall[] }
export interface ToolChoice { required: string[] }
export interface AgentModel {
  readonly provider: string;
  readonly model: string;
  complete(messages: ModelMessage[], tools: ToolDefinition[], signal: AbortSignal, choice?:ToolChoice): Promise<ModelReply>;
}

const settings = z.object({
  provider: z.enum(['ollama', 'openai', 'openai-compatible', 'anthropic', 'gemini', 'vertex']).default('ollama'),
  model: z.string().max(160).default(''),
  base: z.string().url().refine(value => {
    const url=new URL(value);
    return !url.username && !url.password && (url.protocol==='https:' || (url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)));
  }, 'Model endpoints must use HTTPS, except local loopback providers.'),
  key: z.string().optional(),
});
export function agentSettings() {
  const provider = process.env.AGENT_PROVIDER ?? 'ollama';
  if (provider === 'vertex') return { provider: 'vertex' as const, ...vertexSettings(), key: undefined };
  return settings.parse({ provider, model: process.env.AGENT_MODEL ?? (provider === 'ollama' ? 'qwen3:8b' : undefined),
    base: process.env.AGENT_BASE_URL ?? (provider === 'ollama' ? 'http://127.0.0.1:11434' : provider === 'anthropic' ? 'https://api.anthropic.com/v1' : provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://api.openai.com/v1'),
    key: process.env.AGENT_API_KEY });
}

export function agentContextWindowTokens() {
  const override=process.env.AGENT_CONTEXT_WINDOW_TOKENS;
  if(override!==undefined)return z.coerce.number().int().min(4096).max(4_000_000).parse(override);
  const provider=agentSettings().provider;
  if(provider==='ollama')return 16_384;
  if(provider==='anthropic')return 200_000;
  if(provider==='gemini'||provider==='vertex')return 1_048_576;
  if(provider==='openai')return 128_000;
  return 32_768;
}

function argumentsObject(value: unknown): Record<string, unknown> {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  return z.record(z.string(), z.unknown()).parse(parsed);
}
async function post(url: string, body: unknown, signal: AbortSignal, key?: string, extraHeaders: Record<string,string> = {}) {
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...extraHeaders }, body: JSON.stringify(body) });
  } catch { signal.throwIfAborted(); throw new ModelFailure('network'); }
  // Never persist provider errors verbatim: they can contain credentials or prompt data.
  if (!response.ok) { await response.body?.cancel(); throw new ModelFailure('http',response.status); }
  const reader=response.body?.getReader();
  if (!reader) throw new ModelFailure('empty_response');
  const chunks:Uint8Array[]=[];let size=0;
  while (true) {
    const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;
    if(size>256_000){await reader.cancel();throw new ModelFailure('too_large');}
    chunks.push(value);
  }
  const raw=Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw) as Record<string, any>; }
  catch { throw new ModelFailure('invalid_json'); }
}
function functions(tools: ToolDefinition[]) {
  return tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
}

export class OllamaAgentModel implements AgentModel {
  readonly provider = 'ollama';
  constructor(readonly model: string, private readonly base: string) {}
  async complete(messages: ModelMessage[], tools: ToolDefinition[], signal: AbortSignal, choice?:ToolChoice): Promise<ModelReply> {
    // Ollama's native chat API has no tool_choice field. When orchestration has
    // already resolved one action, expose only that tool so the same concise
    // action contract works locally without provider-specific prompt tricks.
    const offered=choice?.required.length?tools.filter(tool=>choice.required.includes(tool.name)):tools;
    const response = await post(`${this.base.replace(/\/$/, '')}/api/chat`, {
      model: this.model, stream: false, think: false, keep_alive: '10m',
      options: { temperature: 0, num_ctx: 16384, num_predict: 1400 },
      tools: functions(offered), messages: messages.map(message => ({ role: message.role, content: message.content,
        ...(message.name ? { tool_name: message.name } : {}),
        ...(message.calls?.length ? { tool_calls: message.calls.map(call => ({ function: { name: call.name, arguments: call.arguments } })) } : {}),
      })),
    }, signal);
    if (!response.message || response.done === false) throw new Error('Incomplete model response.');
    return { text: String(response.message.content ?? '').slice(0, 12000),
      calls: (response.message.tool_calls ?? []).map((call: any, index: number) => ({ id: `call_${index}`, name: String(call.function?.name ?? ''), arguments: argumentsObject(call.function?.arguments) })) };
  }
}

export class CompatibleAgentModel implements AgentModel {
  readonly provider = 'openai-compatible';
  constructor(readonly model: string, private readonly base: string, private readonly key?: string) {}
  async complete(messages: ModelMessage[], tools: ToolDefinition[], signal: AbortSignal, toolChoice?:ToolChoice): Promise<ModelReply> {
    const response = await post(`${this.base.replace(/\/$/, '')}/chat/completions`, {
      model: this.model, stream: false, temperature: 0, max_tokens: 1400, parallel_tool_calls: false,
      tools: functions(tools), ...(toolChoice?.required.length?{tool_choice:toolChoice.required.length===1?{type:'function',function:{name:toolChoice.required[0]}}:'required'}:{}), messages: messages.map(message => ({ role: message.role, content: message.content,
        ...(message.callId ? { tool_call_id: message.callId } : {}),
        ...(message.calls?.length ? { tool_calls: message.calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}),
      })),
    }, signal, this.key);
    const choice = response.choices?.[0];
    if (!choice?.message || choice.finish_reason === 'length') throw new Error('Incomplete model response.');
    return { text: String(choice.message.content ?? '').slice(0, 12000), calls: (choice.message.tool_calls ?? []).map((call: any) => ({
      id: String(call.id), name: String(call.function?.name ?? ''), arguments: argumentsObject(call.function?.arguments),
    })) };
  }
}

/** Responses state is isolated per run. Retain opaque reasoning items between tool turns. */
export class OpenAIResponsesModel implements AgentModel {
  readonly provider = 'openai';
  private input: unknown[] = [];
  private consumed = 0;
  constructor(readonly model: string, private readonly base: string, private readonly key: string) {}
  async complete(messages: ModelMessage[], tools: ToolDefinition[], signal: AbortSignal, choice?:ToolChoice): Promise<ModelReply> {
    for (const message of messages.slice(this.consumed)) {
      if (message.role === 'assistant' && message.calls?.length) continue; // already retained as native output
      if (message.role === 'tool') this.input.push({ type: 'function_call_output', call_id: message.callId, output: message.content });
      else this.input.push({ role: message.role === 'system' ? 'developer' : message.role, content: message.content });
    }
    this.consumed = messages.length;
    const response = await post(`${this.base.replace(/\/$/, '')}/responses`, {
      model: this.model, input: this.input, store: false, parallel_tool_calls: false, max_output_tokens: 2500,
      tools: tools.map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })),
      ...(choice?.required.length?{tool_choice:choice.required.length===1?{type:'function',name:choice.required[0]}:'required'}:{}),
    }, signal, this.key);
    if (response.status !== 'completed') throw new Error('Incomplete model response.');
    const output: any[] = response.output ?? [];
    this.input.push(...output);
    return {
      text: output.filter(item => item.type === 'message').flatMap(item => item.content ?? []).filter(item => item.type === 'output_text').map(item => item.text).join('\n').slice(0, 12000),
      calls: output.filter(item => item.type === 'function_call').map(item => ({ id: item.call_id, name: item.name, arguments: argumentsObject(item.arguments) })),
    };
  }
}
/** Keep native content blocks, including any opaque provider reasoning/signatures. */
export class AnthropicAgentModel implements AgentModel {
  readonly provider='anthropic';
  private history:Array<{role:string;content:any[]}> = [];
  private consumed=0;
  constructor(readonly model:string,private readonly base:string,private readonly key:string) {}
  async complete(messages:ModelMessage[],tools:ToolDefinition[],signal:AbortSignal,choice?:ToolChoice):Promise<ModelReply> {
    for (const message of messages.slice(this.consumed)) {
      if (message.role==='system'||(message.role==='assistant'&&message.calls?.length)) continue;
      if (message.role==='tool') {
        const block={type:'tool_result',tool_use_id:message.callId,content:message.content};
        const last=this.history.at(-1);
        if (last?.role==='user'&&last.content.every(item=>item.type==='tool_result')) last.content.push(block);
        else this.history.push({role:'user',content:[block]});
      } else this.history.push({role:message.role,content:[{type:'text',text:message.content}]});
    }
    this.consumed=messages.length;
    const response=await post(`${this.base.replace(/\/$/,'')}/messages`,{
      model:this.model,max_tokens:2000,system:messages.filter(message=>message.role==='system').map(message=>message.content).join('\n'),messages:this.history,
      tools:tools.map(tool=>({name:tool.name,description:tool.description,input_schema:tool.parameters})),tool_choice:choice?.required.length===1?{type:'tool',name:choice.required[0],disable_parallel_tool_use:true}:{type:choice?.required.length?'any':'auto',disable_parallel_tool_use:true},
    },signal,undefined,{'x-api-key':this.key,'anthropic-version':'2023-06-01'});
    if (!['end_turn','tool_use','stop_sequence'].includes(response.stop_reason)) throw new Error('Incomplete model response.');
    const content:any[]=response.content??[];
    this.history.push({role:'assistant',content});
    return {text:content.filter(item=>item.type==='text').map(item=>item.text).join('\n').slice(0,12000),calls:content.filter(item=>item.type==='tool_use').map(item=>({id:item.id,name:item.name,arguments:argumentsObject(item.input)}))};
  }
}
/** Preserve complete model parts, including Gemini's opaque thought signatures. */
export class GeminiAgentModel implements AgentModel {
  private history:Content[] = [];
  private consumed=0;
  private nativeIds=new Map<string,string|undefined>();
  private client: Pick<GoogleGenAI,'models'>;
  constructor(readonly model:string,private readonly base:string,private readonly key:string,
    readonly provider:'gemini'|'vertex'='gemini',private readonly budget?:ModelBudget,
    client?:Pick<GoogleGenAI,'models'>,
    private readonly diagnostic?:(event:ModelDiagnostic)=>Promise<void>) {
    // Official SDK owns REST serialization, authentication/refresh and typed responses.
    // Disable hidden SDK retries: p-retry below reserves every billable attempt.
    const httpOptions={timeout:60_000,retryOptions:{attempts:1}};
    this.client=client ?? (provider==='vertex'
      ? new GoogleGenAI({vertexai:true,project:vertexSettings().project,location:vertexSettings().location,apiVersion:'v1',httpOptions})
      : new GoogleGenAI({apiKey:key,httpOptions:{...httpOptions,baseUrl:new URL(base).origin},apiVersion:new URL(base).pathname.replace(/^\//,'')}));
  }
  async complete(messages:ModelMessage[],tools:ToolDefinition[],signal:AbortSignal,choice?:ToolChoice):Promise<ModelReply> {
    for(const message of messages.slice(this.consumed)) {
      if(message.role==='system'||(message.role==='assistant'&&message.calls?.length))continue;
      if(message.role==='tool') {
        const nativeId=this.nativeIds.get(message.callId??'');
        if(!message.name)throw new ModelFailure('malformed_call');
        const part={functionResponse:{name:message.name,...(nativeId?{id:nativeId}:{}),response:JSON.parse(message.content)}};
        const last=this.history.at(-1);
        if(last?.role==='user'&&last.parts?.every(item=>item.functionResponse))last.parts.push(part);
        else this.history.push({role:'user',parts:[part]});
      } else this.history.push({role:message.role==='assistant'?'model':'user',parts:[{text:message.content}]});
    }
    this.consumed=messages.length;
    const config:GenerateContentConfig={
      systemInstruction:{parts:[{text:messages.filter(message=>message.role==='system').map(message=>message.content).join('\n')}]},
      maxOutputTokens:this.provider==='vertex'?2048:2500,abortSignal:signal,
      automaticFunctionCalling:{disable:true},
      ...(this.provider==='vertex'?{candidateCount:1,thinkingConfig:{thinkingLevel:ThinkingLevel.LOW}}:{}),
      ...(tools.length?{tools:[{functionDeclarations:tools.map(tool=>({name:tool.name,description:tool.description,parametersJsonSchema:tool.parameters}))}],
        toolConfig:{functionCallingConfig:choice?.required.length
          ? {mode:FunctionCallingConfigMode.ANY,allowedFunctionNames:choice.required}
          : {mode:FunctionCallingConfigMode.VALIDATED}}}:{}),
    };
    // Only model generation is retried. No application tool is dispatched here.
    // Reserve every billable attempt, including failed/uncertain generations.
    return pRetry(async()=>{
      try {
      signal.throwIfAborted();
      if(Buffer.byteLength(JSON.stringify({contents:this.history,config}),'utf8')>180000)throw new ModelFailure('too_large');
      if(this.provider==='vertex') {
        assertAgentEnabled();
        if(!this.budget)throw new Error('A durable cloud AI budget is required.');
        const count=await this.client.models.countTokens({model:this.model,contents:this.history,config:{abortSignal:signal,systemInstruction:config.systemInstruction!,...(config.tools?{tools:config.tools as Tool[]}:{})}});
        await this.budget(z.number().int().nonnegative().parse(count.totalTokens),2048);
        signal.throwIfAborted();
      }
    const response=await this.client.models.generateContent({model:this.model,contents:this.history,config});
    if(Buffer.byteLength(JSON.stringify(response),'utf8')>256000)throw new ModelFailure('too_large');
    const candidate=response.candidates?.[0];
    const finish=String(candidate?.finishReason??'').replace(/^FINISH_REASON_/,'');
    if(response.promptFeedback?.blockReason || ['SAFETY','RECITATION','BLOCKLIST','PROHIBITED_CONTENT','SPII','IMAGE_PROHIBITED_CONTENT'].includes(finish)) throw new ModelFailure('blocked');
    if(finish==='MAX_TOKENS') throw new ModelFailure('output_limit');
    if(['MALFORMED_FUNCTION_CALL','UNEXPECTED_TOOL_CALL'].includes(finish)) throw new ModelFailure('malformed_call');
    if(finish!=='STOP'||!candidate?.content||!Array.isArray(candidate.content.parts))throw new ModelFailure('empty_response');
    const parts=candidate.content.parts;
    const calls=parts.filter(part=>part.functionCall).map((part,index)=>{
      const call=part.functionCall!;const id=call.id??`call_${this.consumed}_${index}`;
      this.nativeIds.set(id,call.id);
      if(!tools.some(tool=>tool.name===call.name))throw new ModelFailure('malformed_call');
      try { return {id,name:call.name!,arguments:argumentsObject(call.args??{})}; }
      catch { throw new ModelFailure('malformed_call'); }
    });
    const text=parts.filter(part=>typeof part.text==='string'&&!part.thought).map(part=>part.text).join('\n').slice(0,12000);
    if(!text.trim()&&!calls.length)throw new ModelFailure('empty_response');
    this.history.push(candidate.content); // preserve all native signatures exactly
    return {text,calls};
      } catch(error) {
        signal.throwIfAborted();
        if(error instanceof ApiError)throw new ModelFailure('http',error.status);
        if(error instanceof SyntaxError)throw new ModelFailure('invalid_json');
        if(error instanceof TypeError && /fetch|network/i.test(error.message))throw new ModelFailure('network');
        throw error;
      }
    },{
      retries:2,minTimeout:1000,maxTimeout:2500,randomize:true,signal,
      shouldRetry:({error})=>error instanceof ModelFailure&&error.retryable,
      onFailedAttempt:async({error,attemptNumber,retriesLeft})=>{
      signal.throwIfAborted();
      if(!(error instanceof ModelFailure))return;
      const retrying=error.retryable&&retriesLeft>0;
      await this.diagnostic?.({code:error.code,...(error.status?{status:error.status}:{}),attempt:attemptNumber,retrying});
      // Discard invalid candidate entirely; never execute partial tool arguments.
      if(retrying&&['malformed_call','output_limit','empty_response','invalid_json'].includes(error.code)) {
        this.history.push({role:'user',parts:[{text:'The previous generation could not be used. Answer concisely using only the declared tools with valid required arguments. Use find_tools if needed. Do not invent data or repeat any school action.'}]});
      }
      },
    });
  }
}
export function createAgentModel(budget?:ModelBudget, diagnostic?:(event:ModelDiagnostic)=>Promise<void>): AgentModel {
  const setting = agentSettings();
  if(setting.provider==='vertex') {
    if(!budget)throw new Error('A durable cloud AI budget is required.');
    return new GeminiAgentModel(setting.model,setting.base,'','vertex',budget,undefined,diagnostic);
  }
  if(setting.provider!=='ollama'&&setting.provider!=='openai-compatible'&&!setting.key)throw new Error('The configured cloud model has no API key.');
  if(!setting.model)throw new Error('Choose an explicit AGENT_MODEL for the configured provider.');
  if (setting.provider === 'ollama') return new OllamaAgentModel(setting.model, setting.base);
  if (setting.provider === 'gemini') return new GeminiAgentModel(setting.model,setting.base,setting.key!,'gemini',undefined,undefined,diagnostic);
  if (setting.provider === 'anthropic') {
    if (!setting.key) throw new Error('The configured cloud model has no API key.');
    return new AnthropicAgentModel(setting.model,setting.base,setting.key);
  }
  if (setting.provider === 'openai') {
    if (!setting.key) throw new Error('The configured cloud model has no API key.');
    return new OpenAIResponsesModel(setting.model, setting.base, setting.key);
  }
  return new CompatibleAgentModel(setting.model, setting.base, setting.key);
}

export async function modelAvailability() {
  const setting = agentSettings();
  try { assertAgentEnabled(); } catch { return {provider:setting.provider,model:setting.model,ready:false,local:setting.provider==='ollama'}; }
  if(setting.provider==='vertex') {
    try { await vertexAccessToken(AbortSignal.timeout(3000)); return {provider:'vertex',model:setting.model,ready:true,local:false}; }
    catch { return {provider:'vertex',model:setting.model,ready:false,local:false}; }
  }
  if (setting.provider !== 'ollama') return { provider: setting.provider, model: setting.model, ready: Boolean(setting.model) && (Boolean(setting.key) || setting.provider === 'openai-compatible'), local: false };
  try {
    const response = await fetch(`${setting.base.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
    if (!response.ok) throw new Error('Unavailable');
    const body = await response.json() as { models?: { name: string }[] };
    return { provider: setting.provider, model: setting.model, ready: Boolean(body.models?.some(model => model.name === setting.model)), local: true };
  } catch { return { provider: setting.provider, model: setting.model, ready: false, local: true }; }
}
