import { afterEach,describe,expect,it,vi } from 'vitest';
import { AnthropicAgentModel,CompatibleAgentModel,GeminiAgentModel,OllamaAgentModel,OpenAIResponsesModel,createAgentModel,agentSettings } from '../src/agent/providers.js';
const tool={name:'read_attendance',description:'Read attendance',parameters:{type:'object',properties:{},additionalProperties:false}};
const signal=new AbortController().signal;
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('provider-independent tool protocols',()=>{
  it('uses Vertex OAuth, counts tokens and reserves allowance before generation',async()=>{
    vi.stubEnv('AGENT_PROVIDER','vertex');vi.stubEnv('AGENT_ENABLED_UNTIL',new Date(Date.now()+86400000).toISOString());
    const events:string[]=[];
    const fetcher=vi.fn().mockImplementation((url:string)=>{
      events.push(url.endsWith(':countTokens')?'count':'generate');
      return Promise.resolve(new Response(JSON.stringify(url.endsWith(':countTokens')?{totalTokens:123}:{candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:'Checked'}]}}]})));
    });vi.stubGlobal('fetch',fetcher);
    const budget=vi.fn(()=>{events.push('reserve');return Promise.resolve();});
    const provider=new GeminiAgentModel('gemini-3.1-flash-lite','https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google','','vertex',budget,()=>Promise.resolve('short-lived-token'));
    expect((await provider.complete([{role:'user',content:'Check attendance'}],[tool],signal)).text).toBe('Checked');
    expect(events).toEqual(['count','reserve','generate']);expect(budget).toHaveBeenCalledWith(123,2048);
    const request=fetcher.mock.calls[1]![1];expect(request.headers.Authorization).toBe('Bearer short-lived-token');
    expect(request.headers['x-goog-api-key']).toBeUndefined();
    expect(JSON.parse(request.body).generationConfig).toMatchObject({candidateCount:1,maxOutputTokens:2048});
  });
  it('never generates when budget is exhausted or cloud access has expired',async()=>{
    vi.stubEnv('AGENT_PROVIDER','vertex');vi.stubEnv('AGENT_ENABLED_UNTIL',new Date(Date.now()+86400000).toISOString());
    const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({totalTokens:100}))));
    vi.stubGlobal('fetch',fetcher);
    const provider=new GeminiAgentModel('gemini-3.1-flash-lite','https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google','','vertex',()=>Promise.reject(new Error('Budget exhausted')),()=>Promise.resolve('token'));
    await expect(provider.complete([],[],signal)).rejects.toThrow(/Budget/);expect(fetcher).toHaveBeenCalledTimes(1);
    vi.stubEnv('AGENT_ENABLED_UNTIL','2020-01-01');
    await expect(provider.complete([],[],signal)).rejects.toThrow(/paused/);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('locks Vertex to the reviewed cheap model and refuses unbudgeted generation',()=>{
    vi.stubEnv('AGENT_PROVIDER','vertex');vi.stubEnv('AGENT_GOOGLE_PROJECT','eduera-511111');vi.stubEnv('AGENT_MODEL','gemini-3.1-flash-lite');
    expect(()=>createAgentModel()).toThrow(/budget/);
    vi.stubEnv('AGENT_MODEL','expensive-model');expect(()=>agentSettings()).toThrow(/approved/);
  });
  it('uses native Ollama tools without thinking or streaming',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({done:true,message:{content:'',tool_calls:[{function:{name:tool.name,arguments:{}}}]}})));
    vi.stubGlobal('fetch',fetcher);
    const result=await new OllamaAgentModel('qwen3:8b','http://localhost:11434').complete([{role:'user',content:'attendance'}],[tool],signal);
    expect(result.calls[0]).toMatchObject({name:tool.name,arguments:{}});
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({model:'qwen3:8b',think:false,stream:false});
  });
  it('serializes compatible assistant calls and tool-call IDs',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'Checked'}}]})));
    vi.stubGlobal('fetch',fetcher);
    await new CompatibleAgentModel('local-custom','https://model.example/v1','key').complete([{role:'assistant',content:'',calls:[{id:'c1',name:tool.name,arguments:{}}]},{role:'tool',content:'{}',callId:'c1'}],[tool],signal);
    const body=JSON.parse(fetcher.mock.calls[0]![1].body);expect(body.messages[0].tool_calls[0].function.arguments).toBe('{}');expect(body.messages[1].tool_call_id).toBe('c1');expect(body.parallel_tool_calls).toBe(false);
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
    expect(fetcher.mock.calls[0]![1].headers['x-goog-api-key']).toBe('key');
  });
  it('requires explicit cloud models and refuses insecure remote endpoints',()=>{
    vi.stubEnv('AGENT_PROVIDER','openai-compatible');vi.stubEnv('AGENT_MODEL','');expect(()=>createAgentModel()).toThrow(/AGENT_MODEL/);
    vi.stubEnv('AGENT_BASE_URL','http://model.example/v1');expect(()=>agentSettings()).toThrow(/HTTPS/);
  });
  it('bounds provider response bytes before parsing',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('x'.repeat(256001))));
    await expect(new OllamaAgentModel('qwen3:8b','http://localhost:11434').complete([],[],signal)).rejects.toThrow(/safety limit/);
  });
  it('does not expose remote provider error bodies',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('secret credential',{status:500})));
    await expect(new OllamaAgentModel('qwen3:8b','http://localhost:11434').complete([],[],signal)).rejects.toThrow('Model service returned HTTP 500.');
  });
});
