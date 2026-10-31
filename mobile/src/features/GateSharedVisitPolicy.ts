import type { SharedVisitChange } from '../../../packages/contracts/src/wire/features/gate/visitSharingApi';
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string';
const instant=(value:unknown):value is string=>text(value)&&Number.isFinite(Date.parse(value));
/** Accept only the owning shared projection; never pass manager snapshots,
 * internal actors or movement metadata into the shared history renderer. */
export function readGateSharedChanges(value:unknown):{changes:SharedVisitChange[];hasMore:boolean} {
  if(!object(value)||!Array.isArray(value.changes)||value.changes.length>25||typeof value.changes_has_more!=='boolean')throw new Error('The current shared visit changes could not be read. Refresh this shared visit.');
  let previous=Infinity;
  const changes=value.changes.map(raw=>{
    if(!object(raw)||!Number.isSafeInteger(raw.revision)||Number(raw.revision)<1||Number(raw.revision)>=previous||!instant(raw.recorded_at)
      ||!instant(raw.starts_at)||!instant(raw.ends_at)||Date.parse(raw.ends_at)<=Date.parse(raw.starts_at)||!text(raw.title)
      ||!['confirmed','cancelled'].includes(String(raw.state))||!Number.isSafeInteger(raw.party_size)||Number(raw.party_size)<1
      ||!text(raw.place_label)||!text(raw.contact_label))throw new Error('A shared plan change is incomplete. Refresh this shared visit before relying on its history.');
    previous=Number(raw.revision);
    return {revision:Number(raw.revision),recorded_at:raw.recorded_at,title:raw.title,starts_at:raw.starts_at,ends_at:raw.ends_at,state:raw.state as SharedVisitChange['state'],party_size:Number(raw.party_size),place_label:raw.place_label,contact_label:raw.contact_label};
  });
  return {changes,hasMore:value.changes_has_more};
}
export function gateSharedVisitTime(value:string,timezone:string) {
  if(!Number.isFinite(Date.parse(value)))return 'Time unavailable';
  try{return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:timezone}).format(new Date(value));}
  catch{return new Date(value).toISOString();}
}
