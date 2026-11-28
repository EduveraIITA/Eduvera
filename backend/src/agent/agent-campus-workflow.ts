import { z } from 'zod';
import { draftCampusName, indoorBuildingName, validateClientUiCall, type ClientUiCall, type ClientUiContext } from './agent-ui.js';

const workspaceCapacity = z.object({count:z.number().int().nonnegative(),limit:z.number().int().positive()});
const campusDirectory = z.object({can_edit:z.boolean(),campuses:z.array(z.object({id:z.uuid(),name:z.string(),code:z.string()}))});
export type CampusRequest =
  | {kind:'create';name?:string;prepared?:true}
  | {kind:'branch'}
  | {kind:'layout';mode:'open'|'setup';campus?:string}
  | {kind:'interiors';campus?:string;floorPlan?:true};

function normalizedRequest(text: string) {
  return text.trim().replace(/[’‘]/gu,"'");
}

function validName(value: string | undefined) {
  const name=value?.trim().replace(/^["“']|["”']$/gu,'').trim();
  const parsed=draftCampusName.safeParse(name);
  return parsed.success ? parsed.data : undefined;
}

const floorPlanTerm = /\bfloor[ -]*plans?\b/iu;
const floorPlanAction = /\b(?:search|find|fetch|get|look\s+(?:up|for)|locate|source|download)\b/iu;
const setupAction = /\b(?:open|show|go\s+to|take\s+me\s+to|start|set\s*up|creat(?:e|ing)|build(?:ing)?|initiali[sz]e|map(?:ping)?\s+(?:my|our|the|this|campus|interiors?)|design|configure|edit|draw|outline|mark|select|generat(?:e|ing)|continue|resume)\b/iu;
const instructionsRequest = /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:how|why|what|where|who|is|are|do\s+i|should|can\s+(?!(?:you|we)\b)\w+|explain|describe|write|draft|check\s+(?:if|whether)|tell\s+me\s+(?:how|about)|show\s+me\s+how|give\s+me\s+(?:an?\s+example|instructions))\b/iu;
const negatedRequest = /\b(?:do(?:\s+not|n'?t)|should(?:\s+not|n'?t)|must(?:\s+not|n'?t)|never|please\s+avoid|not\s+now)\b/iu;
const genericCampusName = /^(?:(?:this|the current|my|our)\s+)?(?:campus|school|institution|building)$/iu;

export function isCampusSetupContinuation(text: string) {
  return /^(?:please\s+)?(?:(?:and\s+)?then\s+)?(?:go\s+ahead|proceed|(?:start|continue|resume)(?:\s+(?:with\s+)?(?:building|setting\s+up|mapping)(?:\s+(?:it|(?:(?:the|this|my|our)\s+)?(?:existing\s+)?campus))?)?|keep\s+going|carry\s+on)[.!?]*$/iu.test(normalizedRequest(text));
}

// The caller supplies an owned, immediately preceding request. The direction is
// planned again against current permission, campus directory and mounted controls.
export function resumeCampusWorkflow(previous: CampusRequest | undefined, text: string, prepared?: {name?:string}) {
  if (!previous || !isCampusSetupContinuation(text)) return undefined;
  if (previous.kind==='create' && prepared) return {kind:'create',prepared:true,...(prepared.name?{name:prepared.name}:{})} as const;
  return previous;
}

export function isCampusFloorPlanWebFollowup(text: string) {
  return /^(?:please\s+)?(?:(?:can(?:not|'?t)?|could(?:n'?t)?|would)\s+you\s+)?(?:search|look\s+up|find\s+it|check)(?:\s+(?:on|the|on\s+the))?\s+(?:internet|web|online)(?:\s+(?:for\s+it|for\s+(?:the\s+)?floor[ -]*plans?))?[.!?]*$/iu.test(normalizedRequest(text));
}

function floorPlanCampus(value: string) {
  const subject=value.replace(/\s+(?:and\s+(?:update|map|set\s*up|import|add|build|show|review|download|use)\b|so\s+(?:I|we)\s+).+$/iu,'')
    .replace(/\s+(?:(?:on|from)\s+(?:the\s+)?(?:internet|web)|online)[.!?]*$/iu,'');
  const after=subject.match(/\bfloor[ -]*plans?\s+(?:of|for|at)\s+(.+?)\s*[.!?]?$/iu)?.[1];
  const before=subject.match(/\b(?:find|fetch|get|locate|download|look\s+(?:up|for)|search(?:\s+(?:the\s+)?(?:internet|web|online))?(?:\s+for)?)\s+(?:(?:the|a|any|public|official|published)\s+)*(.+?)\s+floor[ -]*plans?\b/iu)?.[1];
  const name=validName(after??before);
  return name && !genericCampusName.test(name) && !/^(?:public|official|published|a|the|any|this|the current|my|our)$/iu.test(name) ? name : undefined;
}

function layoutRequest(value: string): CampusRequest | undefined {
  const virtual=/\bvirtual\s+campus\b/iu.test(value);
  const target=value.match(/\b(?:virtual\s+campus(?:\s+(?:layout|map))?|campus\s+(?:map|layout)|layout|boundar(?:y|ies)|outline)\s+(?:of|for|at|around)\s+(.+?)\s*[.!?]?$/iu)?.[1];
  const layout=/\bcampus(?:'s)?\s+(?:layout|map|boundar(?:y|ies)|outline)\b/iu.test(value) || !!target && /\bcampus\b/iu.test(target);
  const build=/\b(?:build|map)\s+(?:(?:my|our|the|this)\s+)?campus\b(?!\s+(?:event|assignment|class|gate|building|group|route|place|facility|room|activity|resource|schedule|asset|location)\b)/iu.test(value);
  if (!setupAction.test(value) || !(virtual||layout||build)) return;
  const mode=/\b(?:open|show|go\s+to|take\s+me\s+to)\s+(?:me\s+)?(?:(?:the|this|my|our)\s+)?(?:virtual\s+campus|campus\s+(?:layout|map)|layout\s+(?:of|for))\b/iu.test(value)
    ? 'open' : 'setup';
  const campus=validName(target);
  return {kind:'layout',mode,...(campus&&!genericCampusName.test(campus)?{campus}:{})};
}

/** Recognize explicit requests for existing controls. The app owns every save. */
export function campusWorkflowRequest(text: string, awaitingCampusName = false): CampusRequest | undefined {
  const value=normalizedRequest(text);
  if (!value || instructionsRequest.test(value) || negatedRequest.test(value)) return;
  if (floorPlanTerm.test(value) && floorPlanAction.test(value)) {
    if (/\b(?:examples?|templates?|samples?|tutorials?|instructions?|guides?)\b/iu.test(value)) return;
    const campus=floorPlanCampus(value);
    return {kind:'interiors',floorPlan:true,...(campus?{campus}:{})};
  }
  const branch=/\b(?:open|add|create|set\s*up|register)\s+(?:(?:a|the|my|our|this)\s+)?(?:(?:new|another|additional)\s+)?(?:branch\s+campus|campus\s+(?:branch|location)|physical\s+campus|campus\s+in\s+(?:this|our|the\s+current)\s+institution|branch(?=$|[.!?,]|\s+(?:named|called|in|at)\b))\b/iu.test(value);
  const interior=/\b(?:interiors?|intir[iy]ors?|interiours?|indoor(?:\s+(?:map|layout|mapping))?)\b/iu.test(value);
  const create=/\b(?:create|add|set\s*up|start|build|provision|want(?:\s+to\s+(?:create|add|set\s*up|start|build))?)\s+(?:an?\s+)?(?:new|another|additional|private)\s+(?:private\s+)?campus(?:\s+workspace)?\b(?!\s+(?:event|assignment|class|gate|building|group|route|place|facility|room|plans?|map|layout|activity|resource|schedule|asset|image|location|branch)\b)/iu.test(value);
  if (branch) return create ? undefined : {kind:'branch'};
  if (create) {
    const name=validName(value.match(/\b(?:named|called|with\s+the\s+name)\s+(.+?)\s*(?:[.!?]?$|(?:,\s*)?and\s+(?:then\s+)?(?:map|build|set\s*up|design|configure)\b)/iu)?.[1]);
    return name ? {kind:'create',name} : {kind:'create'};
  }
  if (setupAction.test(value) && interior) {
    const campus=validName(value.match(/\b(?:interiors?|intir[iy]ors?|interiours?|indoors?)\s+(?:of|for|at)\s+(.+?)\s*[.!?]?$/iu)?.[1]);
    return campus && !genericCampusName.test(campus) ? {kind:'interiors',campus} : {kind:'interiors'};
  }
  const layout=layoutRequest(value);
  if (layout) return layout;
  if (awaitingCampusName) {
    if (isCampusSetupContinuation(value)) return {kind:'create',prepared:true};
    const named=value.match(/^(?:name|call)\s+(?:the campus|it)\s+(.+?)\s*[.!?]?$/iu) ?? value.match(/^use\s+(.+?)\s+as\s+(?:the campus|its)\s+name[.!]?$/iu);
    if (named) {
      const name=validName(named[1]);
      return name ? {kind:'create',name} : undefined;
    }
    const name=validName(value);
    if (name && !setupAction.test(value) && /^[\p{L}\p{N}][\p{L}\p{N} &'"\u2019.-]{1,100}$/u.test(name)
      && !/^(?:yes|sure|ok(?:ay)?|no|stop|cancel|nevermind|wait|help|can|could|would|maybe|thanks|thank you|actually)\b/iu.test(name)) return {kind:'create',name};
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
const virtualCampusHref = '/more/virtual-campus';
const campusSetupHref = '/more/setup/institution/campus';
const campusAccountHref = '/more/account/campuses';
const step = (tool: ClientUiCall['tool'], args: unknown) => validateClientUiCall(tool,args)!;

export function campusWorkflowDirection(request: CampusRequest, context: ClientUiContext | undefined, source: unknown): Direction {
  const tools=context?.tools??[];
  if (request.kind==='create') {
    const capacity=workspaceCapacity.safeParse(source);
    if (!capacity.success) return {calls:[],answer:'Open Your campuses to check your account limit.',href:campusAccountHref};
    if (capacity.data.count>=capacity.data.limit) return {calls:[],answer:`You’ve reached the ${capacity.data.limit}-campus limit.`,href:campusAccountHref};
    const prepare=step('prepare_campus_create',request.name ? {name:request.name} : {});
    const formOpen=request.prepared && context?.screen==='campus_account';
    const calls=formOpen ? []
      : tools.includes('prepare_campus_create') ? [prepare]
        : tools.includes('open_campus_create') ? [step('open_campus_create',{}),prepare] : [];
    const answer=request.name ? 'Review the campus form, then tap Create campus.'
      : formOpen ? 'Review the name in the campus form, then tap Create campus.' : 'Enter a name for the new campus.';
    return {calls,answer,href:campusAccountHref};
  }
  const directory=authorizedCampusDirectory(source);
  if (!directory) return {calls:[],answer:'The campus directory is unavailable.'};
  if (request.kind==='layout' && request.mode==='open' && !request.campus) {
    return {calls:tools.includes('open_virtual_campus')?[step('open_virtual_campus',{})]:[],
      answer:context?.screen==='virtual_campus' ? 'You’re in Virtual Campus.' : 'Open Virtual Campus.',href:virtualCampusHref};
  }
  if (!(request.kind==='layout' && request.mode==='open') && !directory.can_edit)
    return {calls:[],answer:'Ask a campus administrator to edit the layout.'};
  if (request.kind==='branch') return {calls:[],answer:'Add a location for this institution in Campus setup.',href:campusSetupHref};

  const named=selectCampus(directory.campuses,request.campus,context?.campus_id);
  if (request.kind==='layout') {
    if (named) {
      const setup=request.mode==='setup';
      const params=new URLSearchParams({campus_id:named.id,...(setup?{edit:'1'}:{})});
      const calls=setup && tools.includes('open_campus_layout')
        ? [step('open_campus_layout',{campus_id:named.id})]
        : !request.campus && tools.includes('open_virtual_campus') ? [step('open_virtual_campus',{})] : [];
      return {calls,answer:setup?'Continue on the campus map.':`Open ${named.name} in Virtual Campus.`,href:`${virtualCampusHref}?${params.toString()}`};
    }
    if (!directory.campuses.length) {
      if (request.mode==='setup') {
        const calls=tools.includes('open_virtual_campus')?[step('open_virtual_campus',{})]:[];
        return {calls,answer:'Add your first campus location to start the map.',href:campusSetupHref};
      }
      return {calls:[],answer:'There are no campus locations to open.',href:virtualCampusHref};
    }
    return chooseCampus(context,request.campus ? 'Choose the campus you meant.' : 'Choose a campus to continue its layout.');
  }

  const building=!named && request.floorPlan && !directory.campuses.some(campus=>campusMatches(campus,request.campus))
    ? indoorBuildingName.safeParse(request.campus).data : undefined;
  const selected=named ?? (building ? selectCampus(directory.campuses,undefined,context?.campus_id) : undefined);
  if (selected) {
    const params=new URLSearchParams({campus_id:selected.id,edit:'1',indoor:'1',...(building?{indoor_building:building}:{})});
    const href=`${virtualCampusHref}?${params.toString()}`;
    const calls=tools.includes('open_campus_interiors') ? [step('open_campus_interiors',{campus_id:selected.id,...(building?{building_name:building}:{})})] : [];
    const answer=request.floorPlan
      ? 'Choose the building and floor to check for a public plan.'
      : 'Choose a building to map its floors and rooms.';
    return {calls,answer,href};
  }
  if (!directory.campuses.length) return {calls:[],answer:'Add a campus location before mapping its interior.',href:campusSetupHref};
  return chooseCampus(context,request.floorPlan ? 'Choose a campus for the floor-plan search.' : 'Choose a campus to map its interior.');
}

function chooseCampus(context: ClientUiContext | undefined, answer: string): Direction {
  if (context?.tools.includes('campus_open_picker')) return {calls:[step('campus_open_picker',{})],answer};
  const calls=context?.tools.includes('open_virtual_campus') ? [step('open_virtual_campus',{})] : [];
  return {calls,answer,href:virtualCampusHref};
}

type DirectoryCampus = NonNullable<ReturnType<typeof authorizedCampusDirectory>>['campuses'][number];

function campusMatches(campus: DirectoryCampus, named?: string) {
  if (!named) return false;
  const normalize=(value:string)=>value.normalize('NFKC').trim().toLowerCase();
  return [campus.name,campus.code].some(value=>normalize(value)===normalize(named));
}

function selectCampus(campuses: DirectoryCampus[], named?:string, activeId?:string) {
  if (named) {
    const matches=campuses.filter(campus=>campusMatches(campus,named));
    return matches.length===1 ? matches[0] : undefined;
  }
  if (activeId) return campuses.find(campus=>campus.id===activeId);
  return campuses.length===1 ? campuses[0] : undefined;
}
