import { z } from 'zod';
import { draftCampusName, indoorBuildingName, validateClientUiCall, type ClientUiCall, type ClientUiContext } from './agent-ui.js';

const workspaceCapacity = z.object({count:z.number().int().nonnegative(),limit:z.number().int().positive()});
const campusDirectory = z.object({can_edit:z.boolean(),campuses:z.array(z.object({id:z.uuid(),name:z.string(),code:z.string()}))});
export type CampusRequest = {kind:'create';name?:string} | {kind:'branch'} | {kind:'interiors';campus?:string;floorPlan?:true};

function validName(value: string | undefined) {
  const name=value?.trim().replace(/^["“']|["”']$/gu,'').trim();
  const parsed=draftCampusName.safeParse(name);
  return parsed.success ? parsed.data : undefined;
}

const floorPlanTerm = /\bfloor[ -]*plans?\b/iu;
const floorPlanAction = /\b(?:search|find|fetch|get|look\s+(?:up|for)|locate|source|download)\b/iu;

export function isCampusFloorPlanWebFollowup(text: string) {
  const value=text.trim().replace(/[’‘]/gu,"'");
  return /^(?:please\s+)?(?:(?:can(?:not|'t)?|could(?:n't)?|would)\s+you\s+)?(?:search|look\s+up|find\s+it|check)(?:\s+(?:on|the|on\s+the))?\s+(?:internet|web|online)(?:\s+(?:for\s+it|for\s+(?:the\s+)?floor[ -]*plans?))?[.!?]*$/iu.test(value);
}

function floorPlanCampus(value: string) {
  const subject=value.replace(/\s+(?:(?:on|from)\s+(?:the\s+)?(?:internet|web)|online)[.!?]*$/iu,'');
  const after=subject.match(/\bfloor[ -]*plans?\s+(?:of|for|at)\s+(.+?)\s*[.!?]?$/iu)?.[1];
  const before=subject.match(/\b(?:find|fetch|get|locate|download|look\s+(?:up|for)|search(?:\s+(?:the\s+)?(?:internet|web|online))?(?:\s+for)?)\s+(?:the\s+)?(.+?)\s+floor[ -]*plans?\b/iu)?.[1];
  const name=validName(after??before);
  return name && !/^(?:public|official|a public|the public|a|any|this|the current|my|our)(?:\s+(?:floor|campus|building|official|public))*$/iu.test(name) ? name : undefined;
}

/** Recognize explicit requests for existing controls. Keep other conversation
 * in the usual model path and never infer enrollment or campus writes. */
export function campusWorkflowRequest(text: string, awaitingCampusName = false): CampusRequest | undefined {
  const value=text.trim().replace(/[’‘]/gu,"'");
  if (!value || /^(?:please\s+)?(?:how|why|what|where|who|is|are|do\s+i|should|can\s+(?!(?:you|we)\b)\w+)\b/iu.test(value) ||
      /\b(?:don't|do not|never|shouldn't|without)\b/iu.test(value)) return;
  if (floorPlanTerm.test(value) && floorPlanAction.test(value)) {
    const campus=floorPlanCampus(value);
    return {kind:'interiors',floorPlan:true,...(campus?{campus}:{})};
  }
  const action=/\b(?:open|create|add|set\s*up|start|build|provision|want|map|design|configure)\b/iu.test(value);
  const explicitBranch=/\b(?:branch\s+campus|campus\s+(?:branch|location)|physical\s+campus|campus\s+in\s+(?:this|our|the\s+current)\s+institution|(?:add|create|open)\s+(?:a\s+)?(?:new|another)\s+branch)\b/iu.test(value);
  const interior=/\b(?:interiors?|intir[iy]ors?|interiours?|indoor(?:\s+(?:map|layout|mapping))?)\b/iu.test(value);
  const create=/\b(?:a\s+)?(?:new|another|additional|private)\s+(?:private\s+)?campus(?:\s+workspace)?\b(?!\s+(?:event|assignment|class|gate|building|group|route|place|facility|room|plan|map|layout|activity|resource|schedule|asset|image)\b)/iu.test(value);
  if (action && !interior && explicitBranch) return {kind:'branch'};
  if (action && !interior && create) {
    const name=validName(value.match(/\b(?:named|called)\s+(.+?)\s*[.!?]?$/iu)?.[1]);
    return name ? {kind:'create',name} : {kind:'create'};
  }
  if (action && interior) {
    const campus=validName(value.match(/\b(?:interiors?|intir[iy]ors?|interiours?|indoors?)\s+(?:of|for|at)\s+(.+?)\s*[.!?]?$/iu)?.[1]);
    return campus && !/^(?:this|the current|my|our) campus$/iu.test(campus) ? {kind:'interiors',campus} : {kind:'interiors'};
  }
  if (awaitingCampusName) {
    if (/^(?:then\s+)?(?:continue|go ahead|proceed|start(?:\s+building)?)[.!]?$/iu.test(value)) return {kind:'create'};
    const named=value.match(/^(?:name|call)\s+(?:the campus|it)\s+(.+?)\s*[.!?]?$/iu) ?? value.match(/^use\s+(.+?)\s+as\s+(?:the campus|its)\s+name[.!]?$/iu);
    if (named) {
      const name=validName(named[1]);
      return name ? {kind:'create',name} : undefined;
    }
    const name=validName(value);
    if (name && !action && /^[\p{L}\p{N}][\p{L}\p{N} &'".-]{1,100}$/u.test(name)
      && !/^(?:yes|sure|ok(?:ay)?|go ahead|no|stop|cancel|nevermind|not now)\b/iu.test(name)) return {kind:'create',name};
  }
}

export function canPrepareCampus(data: unknown) {
  const parsed=workspaceCapacity.safeParse(data);
  return parsed.success && parsed.data.count<parsed.data.limit;
}

export function authorizedCampusDirectory(data: unknown) {
  const parsed=campusDirectory.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}

type Direction = {calls:ClientUiCall[];answer:string;href?:string};
const step = (tool: ClientUiCall['tool'], args: unknown) => validateClientUiCall(tool,args)!;

export function campusWorkflowDirection(request: CampusRequest, context: ClientUiContext | undefined, source: unknown): Direction {
  const tools=context?.tools??[];
  if (request.kind==='create') {
    if (!canPrepareCampus(source)) return {calls:[],answer:'Check your campus limit in Account.',href:'/more/account/campuses'};
    const prepare=step('prepare_campus_create',request.name ? {name:request.name} : {});
    const calls=tools.includes('prepare_campus_create') ? [prepare]
      : tools.includes('open_campus_create') ? [step('open_campus_create',{}),prepare] : [];
    return {calls,answer:calls.length ? 'I’ll open the campus form.' : 'Open the campus form in Account.',href:'/more/account/campuses'};
  }
  const directory=authorizedCampusDirectory(source);
  if (!directory?.can_edit) return {calls:[],answer:'Campus setup requires current administrator access.'};
  if (request.kind==='branch') return {calls:[],answer:'Add a location to this institution in Campus setup.',href:'/more/setup/institution/campus'};
  const named=selectInteriorCampus(directory.campuses,request.campus,context?.campus_id);
  const building=!named && request.floorPlan ? indoorBuildingName.safeParse(request.campus).data : undefined;
  const selected=named ?? (building ? selectInteriorCampus(directory.campuses,undefined,context?.campus_id) : undefined);
  if (selected) {
    const params=new URLSearchParams({campus_id:selected.id,edit:'1',indoor:'1',...(building?{indoor_building:building}:{})});
    const href=`/more/virtual-campus?${params.toString()}`;
    const calls=tools.includes('open_campus_interiors') ? [step('open_campus_interiors',{campus_id:selected.id,...(building?{building_name:building}:{})})] : [];
    const answer=request.floorPlan ? (calls.length ? 'I’ll open the floor-plan search.' : 'Open the campus floor-plan search.')
      : (calls.length ? 'I’ll open the interior setup.' : 'Open the campus interior setup.');
    return {calls,answer,href};
  }
  if (!directory.campuses.length) return {calls:[],answer:'Add a campus location before mapping its interior.',href:'/more/setup/institution/campus'};
  if (tools.includes('campus_open_picker')) return {calls:[step('campus_open_picker',{})],
    answer:request.floorPlan ? 'Choose a campus for floor-plan search.' : 'Choose a campus for interior setup.'};
  return {calls:[],answer:'Choose a campus in Virtual Campus.',href:'/more/virtual-campus'};
}

function selectInteriorCampus(campuses: NonNullable<ReturnType<typeof authorizedCampusDirectory>>['campuses'], named?:string, activeId?:string) {
  if (named) {
    const matches=campuses.filter(campus=>[campus.name,campus.code].some(value=>value.normalize('NFKC').trim().toLowerCase()===named.normalize('NFKC').trim().toLowerCase()));
    return matches.length===1 ? matches[0] : undefined;
  }
  if (activeId) return campuses.find(campus=>campus.id===activeId);
  return campuses.length===1 ? campuses[0] : undefined;
}
