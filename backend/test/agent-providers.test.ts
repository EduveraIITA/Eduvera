import { afterEach,describe,expect,it,vi } from 'vitest';
import { AnthropicAgentModel,CompatibleAgentModel,GeminiAgentModel,OllamaAgentModel,OpenAIResponsesModel,createAgentModel,agentContextWindowTokens,agentSettings } from '../src/agent/providers.js';
import { ApiError, type GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import { ModelFailure } from '../src/agent/model-errors.js';
const sdkClient=(generate:ReturnType<typeof vi.fn>,count=vi.fn().mockResolvedValue({totalTokens:123}))=>({models:{generateContent:generate,countTokens:count}} as unknown as Pick<GoogleGenAI,'models'>);
const tool={name:'read_attendance',description:'Read attendance',parameters:{type:'object',properties:{},additionalProperties:false}};
const signal=new AbortController().signal;
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('provider-independent tool protocols',()=>{
  it('uses Vertex OAuth, counts tokens and reserves allowance before generation',async()=>{
    vi.stubEnv('AGENT_PROVIDER','vertex');vi.stubEnv('AGENT_ENABLED_UNTIL',new Date(Date.now()+86400000).toISOString());
    const events:string[]=[];
    const generate=vi.fn().mockImplementation(()=>{events.push('generate');return Promise.resolve({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:'Checked'}]}}]});});
    const count=vi.fn().mockImplementation(()=>{events.push('count');return Promise.resolve({totalTokens:123});});
    const budget=vi.fn(()=>{events.push('reserve');return Promise.resolve();});
    const provider=new GeminiAgentModel('gemini-3.1-flash-lite','https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google','','vertex',budget,sdkClient(generate,count));
    expect((await provider.complete([{role:'user',content:'Check attendance'}],[tool],signal)).text).toBe('Checked');
    expect(events).toEqual(['count','reserve','generate']);expect(budget).toHaveBeenCalledWith(123,2048);
    expect(generate.mock.calls[0]![0].config).toMatchObject({candidateCount:1,maxOutputTokens:2048,automaticFunctionCalling:{disable:true},toolConfig:{functionCallingConfig:{mode:'VALIDATED'}}});
  });
  it('requires the single matched action tool at the provider boundary',async()=>{
    vi.stubEnv('AGENT_PROVIDER','vertex');vi.stubEnv('AGENT_ENABLED_UNTIL',new Date(Date.now()+86400000).toISOString());
    const generate=vi.fn().mockResolvedValue({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{functionCall:{name:tool.name,args:{}}}]}}]});
    const provider=new GeminiAgentModel('gemini-3.1-flash-lite','https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google','','vertex',vi.fn().mockResolvedValue(undefined),sdkClient(generate));
    expect((await provider.complete([{role:'user',content:'Do it'}],[tool],signal,{required:[tool.name]})).calls[0]?.name).toBe(tool.name);
    expect(generate.mock.calls[0]![0].config.toolConfig.functionCallingConfig).toMatchObject({mode:'ANY',allowedFunctionNames:[tool.name]});
  });
  it('never generates when budget is exhausted or cloud access has expired',async()=>{
    vi.stubEnv('AGENT_PROVIDER','vertex');vi.stubEnv('AGENT_ENABLED_UNTIL',new Date(Date.now()+86400000).toISOString());
    const generate=vi.fn(),count=vi.fn().mockResolvedValue({totalTokens:100});
    const provider=new GeminiAgentModel('gemini-3.1-flash-lite','https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google','','vertex',()=>Promise.reject(new Error('Budget exhausted')),sdkClient(generate,count));
    await expect(provider.complete([],[],signal)).rejects.toThrow(/Budget/);expect(count).toHaveBeenCalledTimes(1);expect(generate).not.toHaveBeenCalled();
    vi.stubEnv('AGENT_ENABLED_UNTIL','2020-01-01');
    await expect(provider.complete([],[],signal)).rejects.toThrow(/paused/);expect(count).toHaveBeenCalledTimes(1);
  });
  it('locks Vertex to the reviewed cheap model and refuses unbudgeted generation',()=>{
    vi.stubEnv('AGENT_PROVIDER','vertex');vi.stubEnv('AGENT_GOOGLE_PROJECT','eduera-511111');vi.stubEnv('AGENT_MODEL','gemini-3.1-flash-lite');
    expect(()=>createAgentModel()).toThrow(/budget/);
    vi.stubEnv('AGENT_MODEL','expensive-model');expect(()=>agentSettings()).toThrow(/approved/);
  });
  it('uses provider-aware context limits and validates an explicit compaction window',()=>{
    vi.stubEnv('AGENT_PROVIDER','ollama');vi.stubEnv('AGENT_CONTEXT_WINDOW_TOKENS','');
    expect(()=>agentContextWindowTokens()).toThrow();
    vi.stubEnv('AGENT_CONTEXT_WINDOW_TOKENS','4096');expect(agentContextWindowTokens()).toBe(4096);
    vi.stubEnv('AGENT_CONTEXT_WINDOW_TOKENS','4000001');expect(()=>agentContextWindowTokens()).toThrow();
    vi.stubEnv('AGENT_CONTEXT_WINDOW_TOKENS','1048576');expect(agentContextWindowTokens()).toBe(1048576);
  });
  it('uses native Ollama tools without thinking or streaming',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({done:true,message:{content:'',tool_calls:[{function:{name:tool.name,arguments:{}}}]}})));
    vi.stubGlobal('fetch',fetcher);
    const result=await new OllamaAgentModel('qwen3:8b','http://localhost:11434').complete([{role:'user',content:'attendance'}],[tool],signal);
    expect(result.calls[0]).toMatchObject({name:tool.name,arguments:{}});
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({model:'qwen3:8b',think:false,stream:false});
  });
  it('narrows local Ollama to the resolved action tool',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({done:true,message:{content:'',tool_calls:[{function:{name:tool.name,arguments:{}}}]}})));
    vi.stubGlobal('fetch',fetcher);
    const unrelated={name:'send_message',description:'Send a message',parameters:{type:'object',properties:{},additionalProperties:false}};
    await new OllamaAgentModel('qwen3:8b','http://localhost:11434').complete([{role:'user',content:'Do it'}],[unrelated,tool],signal,{required:[tool.name]});
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).tools).toEqual([{type:'function',function:{name:tool.name,description:tool.description,parameters:tool.parameters}}]);
  });
  it('serializes compatible assistant calls and tool-call IDs',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'Checked'}}]})));
    vi.stubGlobal('fetch',fetcher);
    await new CompatibleAgentModel('local-custom','https://model.example/v1','key').complete([{role:'assistant',content:'',calls:[{id:'c1',name:tool.name,arguments:{}}]},{role:'tool',content:'{}',callId:'c1'}],[tool],signal,{required:[tool.name]});
    const body=JSON.parse(fetcher.mock.calls[0]![1].body);expect(body.messages[0].tool_calls[0].function.arguments).toBe('{}');expect(body.messages[1].tool_call_id).toBe('c1');expect(body.parallel_tool_calls).toBe(false);
    expect(body.tool_choice).toEqual({type:'function',function:{name:tool.name}});
  });
  it('retains native OpenAI reasoning and tool outputs without storing server-side',async()=>{
    const output=[{type:'reasoning',id:'r1',summary:[]},{type:'function_call',id:'f1',call_id:'c1',name:tool.name,arguments:'{}'}];
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({status:'completed',output}))).mockResolvedValueOnce(new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Checked'}]}]})));
    vi.stubGlobal('fetch',fetcher);
    const provider=new OpenAIResponsesModel('configured-model','https://api.openai.com/v1','key');
    const messages=[{role:'user' as const,content:'attendance'}];
    const first=await provider.complete(messages,[tool],signal);
    const second=await provider.complete([...messages,{role:'assistant',content:'',calls:first.calls},{role:'tool',content:'{"percentage":93}',callId:'c1'}],[tool],signal);
    const body=JSON.parse(fetcher.mock.calls[1]![1].body);expect(body.store).toBe(false);expect(body.input).toContainEqual(output[0]);expect(body.input).toContainEqual({type:'function_call_output',call_id:'c1',output:'{"percentage":93}'});expect(second.text).toBe('Checked');
  });
  it('fails closed on malformed arguments and incomplete responses',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({done:true,message:{tool_calls:[{function:{name:'bad',arguments:'invalid'}}]}}))));
    await expect(new OllamaAgentModel('qwen3:8b','http://localhost:11434').complete([],[],signal)).rejects.toThrow();
  });
  it('preserves Anthropic blocks and groups consecutive tool results',async()=>{
    const content=[{type:'tool_use',id:'c1',name:tool.name,input:{}}];
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({stop_reason:'tool_use',content}))).mockResolvedValueOnce(new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:'Checked'}]})));
    vi.stubGlobal('fetch',fetcher);
    const provider=new AnthropicAgentModel('configured-model','https://api.anthropic.com/v1','key');
    const first=await provider.complete([{role:'system',content:'Follow app rules'},{role:'user',content:'attendance'}],[tool],signal);
    await provider.complete([{role:'system',content:'Follow app rules'},{role:'user',content:'attendance'},{role:'assistant',content:'',calls:first.calls},{role:'tool',content:'{}',callId:'c1'}],[tool],signal);
    const body=JSON.parse(fetcher.mock.calls[1]![1].body);expect(body.system).toBe('Follow app rules');expect(body.messages[1].content).toEqual(content);expect(body.messages[2].content[0]).toMatchObject({type:'tool_result',tool_use_id:'c1'});
    expect(fetcher.mock.calls[0]![1].headers['x-api-key']).toBe('key');
  });
  it('never silently falls back to a cloud provider',()=>{
    vi.stubEnv('AGENT_PROVIDER','openai');vi.stubEnv('AGENT_API_KEY','');
    expect(()=>createAgentModel()).toThrow(/API key/);
  });
  it('preserves Gemini signatures and function-response IDs without exposing thoughts',async()=>{
    const content={role:'model',parts:[{thought:true,text:'private'},{functionCall:{id:'c1',name:tool.name,args:{}},thoughtSignature:'opaque-signature'}]};
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({candidates:[{finishReason:'STOP',content}]}))).mockResolvedValueOnce(new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:'Checked'}]}}]})));
    vi.stubGlobal('fetch',fetcher);
    const provider=new GeminiAgentModel('configured-model','https://generativelanguage.googleapis.com/v1beta','key');
    const messages=[{role:'user' as const,content:'attendance'}];const first=await provider.complete(messages,[tool],signal);
    expect(first.text).not.toContain('private');
    await provider.complete([...messages,{role:'assistant',content:'',calls:first.calls},{role:'tool',name:tool.name,content:'{}',callId:'c1'}],[tool],signal);
    const body=JSON.parse(fetcher.mock.calls[1]![1].body);expect(body.contents[1]).toEqual(content);expect(body.contents[2].parts[0].functionResponse).toMatchObject({id:'c1',name:tool.name,response:{}});
    expect(new Headers(fetcher.mock.calls[0]![1].headers).get('x-goog-api-key')).toBe('key');
  });
  it('requires explicit cloud models and refuses insecure remote endpoints',()=>{
    vi.stubEnv('AGENT_PROVIDER','openai-compatible');vi.stubEnv('AGENT_MODEL','');expect(()=>createAgentModel()).toThrow(/AGENT_MODEL/);
    vi.stubEnv('AGENT_BASE_URL','http://model.example/v1');expect(()=>agentSettings()).toThrow(/HTTPS/);
  });
  it.each([{payload:[{name:'record_attendance'}]},{payload:null},{payload:'No matches'},{payload:42}])('wraps non-object Gemini tool results in a valid response object: %j',async ({payload})=>{
    const content={role:'model',parts:[{functionCall:{id:'discovery',name:tool.name,args:{}},thoughtSignature:'opaque'}]};
    const generate=vi.fn().mockResolvedValueOnce({candidates:[{finishReason:'STOP',content}]}).mockResolvedValueOnce({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:'Ready'}]}}]});
    const provider=new GeminiAgentModel('test','https://unused.test','key','gemini',undefined,sdkClient(generate));
    const messages=[{role:'user' as const,content:'Find the operation for my earlier request'}];
    const first=await provider.complete(messages,[tool],signal);
    await provider.complete([...messages,{role:'assistant',content:'',calls:first.calls},{role:'tool',name:tool.name,callId:'discovery',content:JSON.stringify(payload)}],[tool],signal);
    expect(generate.mock.calls[1]![0].contents[2].parts[0].functionResponse).toMatchObject({id:'discovery',response:{result:payload}});
  });
  it('bounds provider response bytes before parsing',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('x'.repeat(256001))));
    await expect(new OllamaAgentModel('qwen3:8b','http://localhost:11434').complete([],[],signal)).rejects.toThrow(/too_large/);
  });
  it('does not expose remote provider error bodies',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('secret credential',{status:500})));
    await expect(new OllamaAgentModel('qwen3:8b','http://localhost:11434').complete([],[],signal)).rejects.toThrow('Model service returned HTTP 500.');
  });
});

describe('Gemini recovery through the official SDK',()=>{
  const good={candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:'Checked evidence'}]}}]} as GenerateContentResponse;
  it.each(['MALFORMED_FUNCTION_CALL','UNEXPECTED_TOOL_CALL','MAX_TOKENS'])('recovers %s without exposing or dispatching partial calls',async finishReason=>{
    vi.stubEnv('AGENT_PROVIDER','vertex');vi.stubEnv('AGENT_ENABLED_UNTIL',new Date(Date.now()+86400000).toISOString());
    const generate=vi.fn().mockResolvedValueOnce({candidates:[{finishReason,content:{role:'model',parts:[{functionCall:{name:'unsafe',args:{secret:'do not log'}}}]}}]}).mockResolvedValueOnce(good);
    const reserve=vi.fn().mockResolvedValue(undefined),diagnostic=vi.fn().mockResolvedValue(undefined);
    const provider=new GeminiAgentModel('gemini-3.1-flash-lite','https://unused.test','','vertex',reserve,sdkClient(generate),diagnostic);
    expect((await provider.complete([{role:'user',content:'Analyze records'}],[tool],signal)).text).toBe('Checked evidence');
    expect(reserve).toHaveBeenCalledTimes(2);expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({attempt:1,retrying:true}));
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(generate.mock.calls[1]![0].contents)).not.toContain('unsafe');
  });
  it('retries 429 but never repeats the application tool result or loses its signature',async()=>{
    const signed={role:'model',parts:[{functionCall:{id:'read1',name:tool.name,args:{}},thoughtSignature:'opaque'}]};
    const generate=vi.fn().mockResolvedValueOnce({candidates:[{finishReason:'STOP',content:signed}]}).mockRejectedValueOnce(new ApiError({status:429,message:'PRIVATE BODY'})).mockResolvedValueOnce(good);
    const provider=new GeminiAgentModel('test','https://unused.test','key','gemini',undefined,sdkClient(generate));
    const messages=[{role:'user' as const,content:'Check records'}];const first=await provider.complete(messages,[tool],signal);
    await provider.complete([...messages,{role:'assistant',content:'',calls:first.calls},{role:'tool',name:tool.name,callId:'read1',content:'{"value":42}'}],[tool],signal);
    const history=generate.mock.calls[2]![0].contents;
    expect(history.filter((x:any)=>x.role==='model')).toEqual([signed,good.candidates![0]!.content]);
    expect(history.filter((x:any)=>x.parts?.[0]?.functionResponse)).toHaveLength(1);
  });
  it.each([400,401,403])('does not retry invalid/auth HTTP %s or expose provider bodies',async status=>{
    const generate=vi.fn().mockRejectedValue(new ApiError({status,message:'PRIVATE BODY'}));
    const provider=new GeminiAgentModel('test','https://unused.test','key','gemini',undefined,sdkClient(generate));
    await expect(provider.complete([],[],signal)).rejects.toMatchObject({code:'http',status});expect(generate).toHaveBeenCalledTimes(1);
  });
  it('never retries safety refusals, honours cancellation, and caps failed generation attempts',async()=>{
    const generate=vi.fn().mockResolvedValue({candidates:[{finishReason:'SAFETY'}]});
    const provider=new GeminiAgentModel('test','https://unused.test','key','gemini',undefined,sdkClient(generate));
    await expect(provider.complete([],[],signal)).rejects.toMatchObject({code:'blocked'});expect(generate).toHaveBeenCalledTimes(1);
    await expect(provider.complete([],[],AbortSignal.abort())).rejects.toThrow();expect(generate).toHaveBeenCalledTimes(1);
    generate.mockReset().mockResolvedValue({candidates:[{finishReason:'MALFORMED_FUNCTION_CALL'}]});
    await expect(provider.complete([],[],signal)).rejects.toBeInstanceOf(ModelFailure);expect(generate).toHaveBeenCalledTimes(3);
  });
});
