import { z } from 'zod';
import { campusBuildingElementId, draftCampusName, indoorBuildingName } from './agent-ui.js';
import type { AgentScope, Capability } from './catalogue.js';
import { observed } from './capability-contract.js';
import type { AgentCredentials, AgentGateway } from './gateway.js';

const buildingRows = z.array(z.object({
  element_id:campusBuildingElementId,
  space_id:z.uuid(),
  label:z.string().max(160),
  name:z.string().max(200),
  code:z.string().max(200),
})).max(2000);

export interface CampusInteriorBuilding {
  campus_id:string;
  campus_name:string;
  element_id:string;
  space_id:string;
  label:string;
  aliases:string[];
}

const ownerRead:Capability = {
  name:'campus_interior_buildings',
  title:'Mapped campus buildings',
  description:'Read the current buildings available in the campus editor.',
  domain:'virtual_campus',
  portals:['principal','teacher','parent','student'],
  kind:'read',
  schema:z.object({campus_id:z.uuid()}).strict(),
  contract:observed('Reads the current buildings available in the campus editor.'),
  request:({campus_id},scope)=>({method:'GET',path:`/schools/${scope.schoolId}/campus-scenes/${z.uuid().parse(campus_id)}/interior-buildings/`}),
  screen:()=>'/more/virtual-campus',
};

function buildingDisplayName(...labels:string[]) {
  const visible=labels.map(label=>label.replace(/[<>\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/gu,' ').trim());
  const single=visible.find(label=>label.length===1);
  return visible.find(label=>indoorBuildingName.safeParse(label).success)??(single?`Building ${single}`:'Building');
}

/** Internal resolution only. Keep scene geometry and building indexes out of chat evidence. */
export async function readCampusInteriorBuildings(
  gateway:Pick<AgentGateway,'dispatch'>,
  scope:AgentScope,
  credentials:AgentCredentials,
  directory:{can_edit:boolean;campuses:readonly {id:string;name:string}[]},
  campusId?:string,
): Promise<CampusInteriorBuilding[]> {
  if (!directory.can_edit) return [];
  const campuses=directory.campuses.filter(campus=>!campusId || campus.id===campusId);
  const candidates:CampusInteriorBuilding[]=[];
  for (let index=0;index<campuses.length;index+=4) {
    const batch=await Promise.all(campuses.slice(index,index+4).map(async campus=>{
      const rows=buildingRows.parse(await gateway.dispatch(ownerRead,{campus_id:campus.id},scope,credentials));
      return rows.map(row=>{
        const label=buildingDisplayName(row.label,row.name,row.code);
        const campusName=draftCampusName.safeParse(campus.name.replace(/[<>\p{Cc}\p{Cf}]/gu,' '));
        return {
          campus_id:campus.id,
          campus_name:campusName.data??'Campus',
          element_id:row.element_id,
          space_id:row.space_id,
          label,
          aliases:[row.name,row.code,...(label!==row.label?[row.label]:[])],
        };
      });
    }));
    for (const buildings of batch) candidates.push(...buildings);
  }
  return candidates;
}

function words(value:string) {
  return (value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)??[])
    .map(word=>word==='centre'?'center':word);
}

function identifiers(value:string) {
  const terms=words(value);
  const names=[terms];
  if (terms.length>1 && terms.at(-1)==='building') names.push(terms.slice(0,-1));
  return new Set(names.map(parts=>parts.join('')).filter(Boolean));
}

function initials(value:string) {
  const terms=words(value);
  const names=[terms];
  if (terms.at(-1)==='building') names.push(terms.slice(0,-1));
  return names.filter(parts=>parts.filter(term=>/^\p{L}/u.test(term)).length>=2)
    .map(parts=>parts.map(term=>/^\p{N}/u.test(term)?term:term[0]).join(''));
}

function matchRank(names:string[], search:Set<string>, shorthand:string[]) {
  let rank=0;
  for (const name of names) {
    const direct=identifiers(name);
    if ([...direct].some(value=>search.has(value))) return 2;
    if (initials(name).some(value=>search.has(value)) || shorthand.some(value=>direct.has(value))) rank=1;
  }
  return rank;
}

export function matchCampusInteriorBuildings(candidates:readonly CampusInteriorBuilding[], name:string) {
  const search=identifiers(name), shorthand=initials(name);
  const matches=new Map<string,{building:CampusInteriorBuilding;rank:number}>();
  let best=0;
  for (const building of candidates) {
    const rank=matchRank([building.label,...building.aliases],search,shorthand);
    if (!rank) continue;
    best=Math.max(best,rank);
    const key=`${building.campus_id}:${building.space_id}`;
    if (rank>(matches.get(key)?.rank??0)) matches.set(key,{building,rank});
  }
  return [...matches.values()].filter(match=>match.rank===best).map(match=>match.building);
}

export function campusInteriorBuildingChoices(candidates:readonly CampusInteriorBuilding[]) {
  const choices=new Map<string,CampusInteriorBuilding>();
  for (const candidate of candidates) {
    const key=`${candidate.campus_id}:${candidate.space_id}`;
    if (!choices.has(key)) choices.set(key,candidate);
  }
  return [...choices.values()]
    .sort((a,b)=>a.label.localeCompare(b.label)||a.campus_name.localeCompare(b.campus_name))
    .slice(0,8)
    .map(({campus_id,element_id,label,campus_name})=>({campus_id,element_id,label,campus_name}));
}
