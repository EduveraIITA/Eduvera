import { iconForDestination, type ProductIconName } from '../ui/icon-semantics';
import type { WorkspaceManifest, WorkspaceMoreItem } from '../../../packages/contracts/src/workspace';
import { isInternalHref } from './api-policy';
type SetupOverviewIcon=ProductIconName;
export interface SetupOverviewRow { item:WorkspaceMoreItem; detail:string; icon:SetupOverviewIcon }
/** Presentation of the current setup contributions, never a role-based catalogue. */
export function workspaceSetupOverview(manifest:WorkspaceManifest):{capabilities:WorkspaceMoreItem|null;foundation:SetupOverviewRow[]}|null{
  const items=manifest.more.setup;
  if(!items.length||items.some(item=>!isInternalHref(item.href))||new Set(items.map(item=>item.key)).size!==items.length)return null;
  const find=(key:string)=>items.find(item=>item.key===key)??null;
  const definitions:[string,SetupOverviewIcon,string][]=[
    ['institution','campus','Campuses, spaces, academic structure, operating rules and configuration history'],
    ['responsibilities','responsibilities','Connect people to bounded work, scope, dates and fallback'],
    ['people','people','People records, account access and invitations without duplicate directories'],
    ['organization','organization','Describe teams and reporting lines without granting authority'],
  ];
  const represented=new Set(['capabilities','institution','people','responsibilities','invitations','organization']);
  const foundation:SetupOverviewRow[]=definitions.flatMap(([key,icon,detail])=>{const item=find(key);return item?[{item,icon:iconForDestination(item.href,icon),detail}]:[];});
  foundation.push(...items.filter(item=>!represented.has(item.key)).map(item=>({item,icon:iconForDestination(item.href,'settings'),detail:item.description??'Open this authorized campus configuration workspace'})));
  return{capabilities:find('capabilities'),foundation};
}
