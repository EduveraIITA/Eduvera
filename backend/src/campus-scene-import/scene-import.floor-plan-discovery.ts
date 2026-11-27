import { ServiceUnavailableException } from '@nestjs/common';
import { isIP } from 'node:net';
import { z } from 'zod';
import { MAX_SCENE_IMAGE_BYTES } from '../campus-scenes/campus-scenes.contracts.js';
import { freePublicWebEnabled, FREE_PUBLIC_WEB_DAILY_LIMIT } from '../common/public-web-lookup.js';
import { assertLiveExternalEffect } from '../common/simulation-effects.js';

const BRAVE_WEB_SEARCH = 'https://api.search.brave.com/res/v1/web/search';
const EXA_WEB_SEARCH = 'https://mcp.exa.ai/mcp';
const EXA_MCP_PROTOCOL = '2025-03-26';
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_CANDIDATES = 3;

export type PublicFloorPlanLink = { title: string; url: string; source_host: string; source_id?: string; floor_label?: string; source_page?: string };
export type FloorPlanDiscovery =
  | { status: 'found' | 'not_found'; candidates: PublicFloorPlanLink[] }
  | { status: 'unavailable'; candidates: []; reason: string };

export const floorPlanSearchUnavailable = (reason: string): FloorPlanDiscovery => ({
  status: 'unavailable', candidates: [], reason,
});

export function floorPlanSearchSettings() {
  const apiKey = process.env.CAMPUS_FLOOR_PLAN_SEARCH_API_KEY?.trim();
  const maximumDailyLookups = Number(process.env.CAMPUS_FLOOR_PLAN_SEARCH_MAX_DAILY);
  if (!apiKey || !Number.isInteger(maximumDailyLookups) || maximumDailyLookups < 1 || maximumDailyLookups > 1000)
    return null;
  return { apiKey, maximumDailyLookups };
}

export function freeFloorPlanSearchSettings() {
  return freePublicWebEnabled() ? {maximumDailyLookups:FREE_PUBLIC_WEB_DAILY_LIMIT} : null;
}

function officialUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname;
    if (url.protocol !== 'https:' || url.username || url.password || url.port || hostname.length > 200 || isIP(hostname)
      || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/u.test(hostname)
      || /\.(?:localhost|local|internal|home|lan|localdomain|corp|arpa|test|example|invalid|onion)$/u.test(hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function officialSchoolHost(value: string): string | null {
  const host = officialUrl(value)?.hostname;
  return host?.replace(/^www\./u, '') ?? null;
}

export function publicWebUrl(value: string): string | null {
  if(value.length>2048||/[\s\\?#]/u.test(value)||!/^https:\/\//iu.test(value))return null;
  const url=officialUrl(value);
  if(!url||/%(?:[01][0-9a-f]|23|3f|40|5c|7f)/iu.test(url.pathname)||/(?:^|\/)(?:oauth|signin|login|private|internal|redirect)(?:\/|$)/iu.test(url.pathname))return null;
  return url.href;
}

function normalWords(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}

function containsWords(haystack: string, needle: string) {
  return Boolean(needle) && ` ${haystack} `.includes(` ${needle} `);
}

const LULU_HOST = 'lucknow.lulumall.in';
const LULU_SOURCE = `https://www.${LULU_HOST}/floor-plans/`;
const LULU_IMAGE_ROOT = `https://www.${LULU_HOST}/wp-content/uploads/2026/01/`;
const LULU_PLANS = [
  {key:'ground',label:'Ground Floor',filename:'gf-scaled.jpg',floorNames:['ground','ground floor','floor 0','level 0','g','gf']},
  {key:'first',label:'First Floor',filename:'ff-scaled.jpg',floorNames:['first','first floor','1st floor','floor 1','level 1','1']},
  {key:'second',label:'Second Floor',filename:'sf-scaled.jpg',floorNames:['second','second floor','2nd floor','floor 2','level 2','2']},
] as const;

type VerifiedPublicFloorPlan = PublicFloorPlanLink & { source_id:string; floor_label:string; source_page:string };
function verifiedLuluSource(plan:(typeof LULU_PLANS)[number]): VerifiedPublicFloorPlan {
  return {source_id:`lulu-lucknow-${plan.key}`,floor_label:plan.label,title:`LuLu Mall Lucknow · ${plan.label}`,
    url:LULU_IMAGE_ROOT+plan.filename,source_host:`www.${LULU_HOST}`,source_page:LULU_SOURCE};
}

export function verifiedPublicFloorPlans(identity: { building:string; mappedLabel:string; campus:string; floor?:string|undefined; hosts:readonly (string|null)[] }): VerifiedPublicFloorPlan[] {
  const buildingNames=[identity.building,identity.mappedLabel].map(normalWords);
  const exactLocalName=buildingNames.some(name=>name==='lulu mall lucknow'||name==='lucknow lulu mall');
  const matchingMall=buildingNames.includes('lulu mall');
  const matchingCity=identity.hosts.includes(LULU_HOST) || containsWords(normalWords(identity.campus),'lucknow');
  if(!exactLocalName && !(matchingMall && matchingCity))return [];
  const floor=identity.floor ? normalWords(identity.floor) : '';
  return LULU_PLANS.filter(plan=>!floor||plan.floorNames.some(name=>name===floor)).map(verifiedLuluSource);
}

/** Only a currently matched, app-owned publisher entry can provide a download.
 * The caller also confirms rights and checks the exact workspace and floor. */
export async function downloadVerifiedPublicFloorPlan(sourceId: string): Promise<Buffer> {
  assertLiveExternalEffect('Public floor-plan download');
  const failed = () => new ServiceUnavailableException('The publisher’s floor-plan image could not be downloaded. Open its source or use guided setup.');
  const source=LULU_PLANS.map(verifiedLuluSource).find(candidate=>candidate.source_id===sourceId);
  if(!source)throw failed();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response=await fetch(source.url,{
      redirect:'error',
      signal:AbortSignal.timeout(10_000),
      headers:{Accept:'image/jpeg','User-Agent':'ThatCampus floor-plan importer',Referer:source.source_page},
    });
    const declaredSize=Number(response.headers.get('content-length'));
    if(!response.ok || !response.body || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='image/jpeg'
      || declaredSize>MAX_SCENE_IMAGE_BYTES) {
      await response.body?.cancel();
      throw failed();
    }
    reader=response.body.getReader();
    const chunks:Uint8Array[]=[];
    let size=0;
    for(;;) {
      const next=await reader.read();
      if(next.done)break;
      size+=next.value.byteLength;
      if(size>MAX_SCENE_IMAGE_BYTES)throw failed();
      chunks.push(next.value);
    }
    const bytes=Buffer.concat(chunks);
    if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[2]!==0xff)throw failed();
    return bytes;
  } catch {
    if(reader)await reader.cancel().catch(()=>undefined);
    throw failed();
  } finally {
    reader?.releaseLock();
  }
}

function publicFloorPlanLinks(
  payload: unknown, officialHost: string, building: string, floor?: string,
): PublicFloorPlanLink[] {
  if (!payload || typeof payload !== 'object' || !('web' in payload) || !payload.web || typeof payload.web !== 'object'
    || !('results' in payload.web) || !Array.isArray(payload.web.results)) return [];
  const buildingWords = normalWords(building);
  const floorWords = floor ? normalWords(floor) : '';
  const links = new Map<string, PublicFloorPlanLink>();
  for (const item of payload.web.results.slice(0, 10) as unknown[]) {
    if (!item || typeof item !== 'object' || !('url' in item) || typeof item.url !== 'string'
      || item.url.length > 1024 || !('title' in item) || typeof item.title !== 'string') continue;
    const url = officialUrl(item.url);
    // Unknown query parameters can be credentials or redirect endpoints.
    // Only return direct, same-origin document or page links from the public index.
    if (!url || url.search || url.pathname === '/' || officialSchoolHost(url.href) !== officialHost) continue;
    const title = item.title.replace(/\s+/gu, ' ').trim().slice(0, 180);
    if (!title || /[<>\p{Cc}]/u.test(title)) continue;
    const description = 'description' in item && typeof item.description === 'string' ? item.description.slice(0, 600) : '';
    let path: string;
    try { path = decodeURIComponent(url.pathname); } catch { continue; }
    const subject = normalWords(`${title} ${path}`);
    const evidence = normalWords(`${subject} ${description}`);
    const subjectWithHost = normalWords(`${subject} ${officialHost}`);
    const buildingTerms=buildingWords.split(' ').filter(Boolean);
    const buildingMatches=containsWords(evidence,buildingWords) || (buildingTerms.length>1 &&
      buildingTerms.every(term=>containsWords(subjectWithHost,term)) && buildingTerms.some(term=>containsWords(subject,term)));
    if (!/\b(?:floor ?plans?|floor layout|level plans?)\b/u.test(subject)
      || !buildingMatches
      || (floorWords && !containsWords(evidence, floorWords))) continue;
    url.hash = '';
    links.set(url.href, { title, url: url.href, source_host: url.hostname });
    if (links.size >= MAX_CANDIDATES) break;
  }
  return [...links.values()];
}

async function readSearchResponse(response: Response) {
  if (!response.ok || !response.body) throw new Error('Public search unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Public search result too large');
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const mcpReply=z.object({jsonrpc:z.literal('2.0'),id:z.number(),result:z.unknown().optional()});
const mcpTools=z.object({tools:z.array(z.object({name:z.string()})).max(10)});
const mcpInitialization=z.object({protocolVersion:z.literal(EXA_MCP_PROTOCOL)});
const mcpSearchResult=z.object({isError:z.boolean().optional(),content:z.array(z.object({type:z.string(),text:z.string().optional()})).max(10)});

function decodeMcpResponse(text: string, id: number, isEventStream: boolean) {
  const candidates=isEventStream ? text.split(/\r?\n\r?\n/u).map(event=>event.split(/\r?\n/u)
    .filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n')).filter(Boolean) : [text];
  for(const candidate of candidates) {
    const result=mcpReply.safeParse(JSON.parse(candidate));
    if(result.success && result.data.id===id && result.data.result!==undefined)return result.data.result;
  }
  throw new Error('Public search returned an unreadable response');
}

function exaSearchEvidence(payload: unknown) {
  const result=mcpSearchResult.safeParse(payload);
  if(!result.success||result.data.isError)throw new Error('Public search unavailable');
  const results=result.data.content.flatMap(item=>item.type==='text'&&item.text?item.text.split(/^---\s*$/mu):[])
    .slice(0,10).flatMap(group=>{
      const title=group.match(/^Title:[^\S\r\n]*([^\r\n]+)$/mu)?.[1];
      const url=group.match(/^URL:[^\S\r\n]*([^\r\n]+)$/mu)?.[1]?.trim();
      const description=group.match(/^Highlights:\s*([\s\S]*)$/mu)?.[1]?.slice(0,600)??'';
      return title && url ? [{title,url,description}] : [];
    });
  return results;
}

/** Only our two fixed read tools are callable. The app never requests a source URL directly. */
async function callKeylessWeb(tool:'web_search_exa'|'web_fetch_exa',args:Record<string,unknown>,cancel?:AbortSignal) {
  assertLiveExternalEffect('Public web lookup');
  const timeout=AbortSignal.timeout(8_000);
  const signal=cancel ? AbortSignal.any([timeout,cancel]) : timeout;
  let session:string|null=null;
  const send=async(method:string,params:unknown,id?:number)=>{
    const response=await fetch(`${EXA_WEB_SEARCH}?tools=${tool}`,{method:'POST',redirect:'error',signal,
      headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',
        'MCP-Protocol-Version':EXA_MCP_PROTOCOL,'User-Agent':'ThatCampus public web lookup',...(session?{'Mcp-Session-Id':session}:{})},
      body:JSON.stringify({jsonrpc:'2.0',method,params,...(id===undefined?{}:{id})}),
    });
    if(!response.ok)throw new Error('Free public search unavailable');
    if(id===undefined){await response.body?.cancel();return;}
    if(method==='initialize')session=response.headers.get('mcp-session-id');
    return decodeMcpResponse(await readSearchResponse(response),id,response.headers.get('content-type')?.startsWith('text/event-stream')??false);
  };
  mcpInitialization.parse(await send('initialize',{protocolVersion:EXA_MCP_PROTOCOL,capabilities:{},clientInfo:{name:'ThatCampus',version:'1.0.0'}},1));
  await send('notifications/initialized',{});
  const available=mcpTools.parse(await send('tools/list',{},2));
  if(!available.tools.some(item=>item.name===tool))throw new Error('Free public web lookup is unavailable');
  return send('tools/call',{name:tool,arguments:args},3);
}

/** Keyless floor-plan discovery keeps same-host and exact building/floor validation. */
export async function discoverFreePublicFloorPlans(source: {host:string;building:string;floor?:string}): Promise<FloorPlanDiscovery> {
  const building=normalWords(source.building).slice(0,100);
  const floor=source.floor ? normalWords(source.floor).slice(0,50) : '';
  if(!building)return floorPlanSearchUnavailable('Give this building a campus name before searching for a public floor plan.');
  try {
    const query=`site:${source.host} "${building}"${floor?` "${floor}"`:''} "floor plan"`;
    const result=await callKeylessWeb('web_search_exa',{query,numResults:5});
    const candidates=publicFloorPlanLinks({web:{results:exaSearchEvidence(result)}},source.host,source.building,source.floor);
    return {status:candidates.length?'found':'not_found',candidates};
  } catch {
    return floorPlanSearchUnavailable('Free public floor-plan search could not finish. Try again or use guided setup.');
  }
}

export type PublicWebRequest={kind:'search';query:string}|{kind:'read';url:string}|{kind:'invalid'};
export function publicWebRequest(question:string): PublicWebRequest|undefined {
  const search=question.match(/^(?:please\s+)?(?:can you\s+)?search\s+(?:(?:the\s+)?(?:web|internet)|online)\s+for\b([\s\S]*)$/iu)?.[1]?.trim();
  if(search!==undefined)return search.length>0&&search.length<=220&&!/[\p{Cc}\p{Cf}<>]|https?:\/\/|(?:token|signature|api[_ -]?key)\s*=/iu.test(search)
    ? {kind:'search',query:search} : {kind:'invalid'};
  const read=question.match(/^(?:please\s+)?(?:can you\s+)?(?:read|fetch|open)\s+((?:(?:this\s+)?(?:public\s+)?(?:web\s*)?page\b|https?:\/\/)[\s\S]*)$/iu)?.[1];
  if(read===undefined)return;
  const url=publicWebUrl(read.replace(/^(?:this\s+)?(?:public\s+)?(?:web\s*)?page\s*/iu,'').trim());
  return url ? {kind:'read',url} : {kind:'invalid'};
}

export const publicWebSourceSchema=z.object({id:z.uuid(),title:z.string().min(1).max(150),
  url:z.string().refine(value=>publicWebUrl(value)===value),description:z.string().max(220).optional()}).strict();
export type PublicWebSource=z.infer<typeof publicWebSourceSchema>;
const plainExcerpt=(value:string,max:number)=>value.replace(/<[^>]*>/gu,' ').replace(/^[ \t]{0,3}#{1,6}[ \t]+/gmu,'').replace(/[\p{Cc}\p{Cf}<>]/gu,' ')
  .replace(/\s+/gu,' ').trim().slice(0,max);

export async function lookupPublicWeb(request:Exclude<PublicWebRequest,{kind:'invalid'}>,signal:AbortSignal) {
  if(request.kind==='search') {
    const result=await callKeylessWeb('web_search_exa',{query:request.query,numResults:5},signal);
    const sources=new Map<string,Omit<PublicWebSource,'id'>>();
    for(const item of exaSearchEvidence(result)) {
      const url=publicWebUrl(item.url),title=plainExcerpt(item.title,150),description=plainExcerpt(item.description,220);
      if(url&&title)sources.set(url,{url,title,...(description?{description}:{})});
      if(sources.size===3)break;
    }
    return [...sources.values()];
  }
  if(!publicWebUrl(request.url))return [];
  const result=mcpSearchResult.parse(await callKeylessWeb('web_fetch_exa',{urls:[request.url],maxCharacters:700},signal));
  if(result.isError)throw new Error('Public page could not be read');
  return result.content.flatMap(item=>{
    if(item.type!=='text'||!item.text)return [];
    const lines=item.text.match(/^# ([^\r\n]+)\r?\nURL: ([^\r\n]+)\r?\n([\s\S]*)$/u);
    const url=lines?.[2]&&publicWebUrl(lines[2].trim());
    const title=plainExcerpt(lines?.[1]??'',150),description=plainExcerpt(lines?.[3]??'',220);
    return url===request.url && title && description ? [{url,title,description}] : [];
  }).slice(0,1);
}

/** The indexed evidence is discovery only. This adapter never contacts a result URL. */
export async function discoverPublicFloorPlans(
  settings: NonNullable<ReturnType<typeof floorPlanSearchSettings>>,
  source: { host: string; building: string; floor?: string },
): Promise<FloorPlanDiscovery> {
  assertLiveExternalEffect('Public floor-plan search');
  const endpoint = new URL(BRAVE_WEB_SEARCH);
  const building = normalWords(source.building).slice(0, 100);
  const floor = source.floor ? normalWords(source.floor).slice(0, 50) : '';
  if (!building) return floorPlanSearchUnavailable('Give this building a campus name before searching for a public floor plan.');
  endpoint.searchParams.set('q', `site:${source.host} "${building}"${floor ? ` "${floor}"` : ''} "floor plan"`);
  endpoint.searchParams.set('count', '10');
  endpoint.searchParams.set('result_filter', 'web');
  endpoint.searchParams.set('text_decorations', 'false');
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': settings.apiKey },
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    const decoded:unknown=JSON.parse(await readSearchResponse(response));
    const candidates = publicFloorPlanLinks(decoded, source.host, source.building, source.floor);
    return { status: candidates.length ? 'found' : 'not_found', candidates };
  } catch {
    return floorPlanSearchUnavailable('Public floor-plan search could not finish. Try again or use guided setup.');
  }
}
