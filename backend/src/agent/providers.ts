import { z } from 'zod';

export interface ToolDefinition { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolCall { id: string; name: string; arguments: Record<string, unknown> }
export interface ModelMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; calls?: ToolCall[]; callId?: string; name?: string }
export interface ModelReply { text: string; calls: ToolCall[] }
export interface AgentModel {
  readonly provider: string;
  readonly model: string;
  complete(messages: ModelMessage[], tools: ToolDefinition[], signal: AbortSignal): Promise<ModelReply>;
}

const settings = z.object({
  provider: z.enum(['ollama', 'openai', 'openai-compatible', 'anthropic', 'gemini']).default('ollama'),
  model: z.string().max(160).default(''),
  base: z.string().url().refine(value => {
    const url=new URL(value);
    return !url.username && !url.password && (url.protocol==='https:' || (url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)));
  }, 'Model endpoints must use HTTPS, except local loopback providers.'),
  key: z.string().optional(),
});
export function agentSettings() {
  const provider = process.env.AGENT_PROVIDER ?? 'ollama';
  return settings.parse({ provider, model: process.env.AGENT_MODEL ?? (provider === 'ollama' ? 'qwen3:8b' : undefined),
    base: process.env.AGENT_BASE_URL ?? (provider === 'ollama' ? 'http://127.0.0.1:11434' : provider === 'anthropic' ? 'https://api.anthropic.com/v1' : provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://api.openai.com/v1'),
    key: process.env.AGENT_API_KEY });
}

function argumentsObject(value: unknown): Record<string, unknown> {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  return z.record(z.string(), z.unknown()).parse(parsed);
}
async function post(url: string, body: unknown, signal: AbortSignal, key?: string, extraHeaders: Record<string,string> = {}) {
  const response = await fetch(url, { method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...extraHeaders }, body: JSON.stringify(body) });
  // Never persist provider errors verbatim: they can contain credentials or prompt data.
  if (!response.ok) throw new Error(`Model service returned HTTP ${response.status}.`);
  const reader=response.body?.getReader();
  if (!reader) throw new Error('Empty model response.');
  const chunks:Uint8Array[]=[];let size=0;
  while (true) {
    const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;
    if(size>256_000){await reader.cancel();throw new Error('Model response exceeded the safety limit.');}
    chunks.push(value);
  }
  const raw=Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw) as Record<string, any>;
}
function functions(tools: ToolDefinition[]) {
  return tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
}

export class OllamaAgentModel implements AgentModel {
  readonly provider = 'ollama';
  constructor(readonly model: string, private readonly base: string) {}
  async complete(messages: ModelMessage[], tools: ToolDefinition[], signal: AbortSignal): Promise<ModelReply> {
    const response = await post(`${this.base.replace(/\/$/, '')}/api/chat`, {
      model: this.model, stream: false, think: false, keep_alive: '10m',
      options: { temperature: 0, num_ctx: 16384, num_predict: 1400 },
      tools: functions(tools), messages: messages.map(message => ({ role: message.role, content: message.content,
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
  async complete(messages: ModelMessage[], tools: ToolDefinition[], signal: AbortSignal): Promise<ModelReply> {
    const response = await post(`${this.base.replace(/\/$/, '')}/chat/completions`, {
      model: this.model, stream: false, temperature: 0, max_tokens: 1400, parallel_tool_calls: false,
      tools: functions(tools), messages: messages.map(message => ({ role: message.role, content: message.content,
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
  async complete(messages: ModelMessage[], tools: ToolDefinition[], signal: AbortSignal): Promise<ModelReply> {
    for (const message of messages.slice(this.consumed)) {
      if (message.role === 'assistant' && message.calls?.length) continue; // already retained as native output
      if (message.role === 'tool') this.input.push({ type: 'function_call_output', call_id: message.callId, output: message.content });
      else this.input.push({ role: message.role === 'system' ? 'developer' : message.role, content: message.content });
    }
    this.consumed = messages.length;
    const response = await post(`${this.base.replace(/\/$/, '')}/responses`, {
      model: this.model, input: this.input, store: false, parallel_tool_calls: false, max_output_tokens: 2500,
      tools: tools.map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })),
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
  async complete(messages:ModelMessage[],tools:ToolDefinition[],signal:AbortSignal):Promise<ModelReply> {
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
      tools:tools.map(tool=>({name:tool.name,description:tool.description,input_schema:tool.parameters})),tool_choice:{type:'auto',disable_parallel_tool_use:true},
    },signal,undefined,{'x-api-key':this.key,'anthropic-version':'2023-06-01'});
    if (!['end_turn','tool_use','stop_sequence'].includes(response.stop_reason)) throw new Error('Incomplete model response.');
    const content:any[]=response.content??[];
    this.history.push({role:'assistant',content});
    return {text:content.filter(item=>item.type==='text').map(item=>item.text).join('\n').slice(0,12000),calls:content.filter(item=>item.type==='tool_use').map(item=>({id:item.id,name:item.name,arguments:argumentsObject(item.input)}))};
  }
}
/** Preserve complete model parts, including Gemini's opaque thought signatures. */
export class GeminiAgentModel implements AgentModel {
  readonly provider='gemini';
  private history:Array<{role:string;parts:any[]}> = [];
  private consumed=0;
  private nativeIds=new Map<string,string|undefined>();
  constructor(readonly model:string,private readonly base:string,private readonly key:string) {}
  async complete(messages:ModelMessage[],tools:ToolDefinition[],signal:AbortSignal):Promise<ModelReply> {
    for(const message of messages.slice(this.consumed)) {
      if(message.role==='system'||(message.role==='assistant'&&message.calls?.length))continue;
      if(message.role==='tool') {
        const nativeId=this.nativeIds.get(message.callId??'');
        const part={functionResponse:{name:message.name,...(nativeId?{id:nativeId}:{}),response:JSON.parse(message.content)}};
        const last=this.history.at(-1);
        if(last?.role==='user'&&last.parts.every(item=>item.functionResponse))last.parts.push(part);
        else this.history.push({role:'user',parts:[part]});
      } else this.history.push({role:message.role==='assistant'?'model':'user',parts:[{text:message.content}]});
    }
    this.consumed=messages.length;
    const response=await post(`${this.base.replace(/\/$/,'')}/models/${encodeURIComponent(this.model)}:generateContent`,{
      systemInstruction:{parts:[{text:messages.filter(message=>message.role==='system').map(message=>message.content).join('\n')}]},
      contents:this.history,generationConfig:{maxOutputTokens:2500},
      tools:[{functionDeclarations:tools.map(tool=>({name:tool.name,description:tool.description,parametersJsonSchema:tool.parameters}))}],
      toolConfig:{functionCallingConfig:{mode:'AUTO'}},
    },signal,undefined,{'x-goog-api-key':this.key});
    const candidate=response.candidates?.[0];
    if(candidate?.finishReason!=='STOP'||!candidate.content?.parts)throw new Error('Incomplete model response.');
    this.history.push(candidate.content);
    const parts:any[]=candidate.content.parts;
    const calls=parts.filter(part=>part.functionCall).map((part,index)=>{
      const call=part.functionCall;const id=call.id??`call_${this.consumed}_${index}`;
      this.nativeIds.set(id,call.id);
      return {id,name:call.name,arguments:argumentsObject(call.args??{})};
    });
    return {text:parts.filter(part=>typeof part.text==='string'&&!part.thought).map(part=>part.text).join('\n').slice(0,12000),calls};
  }
}
export function createAgentModel(): AgentModel {
  const setting = agentSettings();
  if(setting.provider!=='ollama'&&setting.provider!=='openai-compatible'&&!setting.key)throw new Error('The configured cloud model has no API key.');
  if(!setting.model)throw new Error('Choose an explicit AGENT_MODEL for the configured provider.');
  if (setting.provider === 'ollama') return new OllamaAgentModel(setting.model, setting.base);
  if (setting.provider === 'gemini') return new GeminiAgentModel(setting.model,setting.base,setting.key!);
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
  if (setting.provider !== 'ollama') return { provider: setting.provider, model: setting.model, ready: Boolean(setting.model) && (Boolean(setting.key) || setting.provider === 'openai-compatible'), local: false };
  try {
    const response = await fetch(`${setting.base.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
    if (!response.ok) throw new Error('Unavailable');
    const body = await response.json() as { models?: { name: string }[] };
    return { provider: setting.provider, model: setting.model, ready: Boolean(body.models?.some(model => model.name === setting.model)), local: true };
  } catch { return { provider: setting.provider, model: setting.model, ready: false, local: true }; }
}
