import type { AccommodationOptions, AccommodationRoom, AllocationMode, RoomPlace, RoomType } from '../../../packages/contracts/src/wire/features/accommodation/accommodationApi';
import type { RecordedCommand } from './recorded-command';
export type AccommodationSetupKind='room_type'|'room'|'place';
export type AccommodationSetupRecord=RoomType|AccommodationRoom|RoomPlace;
export interface AccommodationSetupAccepted {command:RecordedCommand;record:AccommodationSetupRecord}
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const whole=(value:unknown,min=1,max=1000):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max;
const mode=(value:unknown):value is AllocationMode=>value==='whole_room'||value==='shared';
export const accommodationSetupKind=(value:unknown):value is AccommodationSetupKind=>value==='room_type'||value==='room'||value==='place';
export const accommodationSetupPath=(root:string,kind:AccommodationSetupKind)=>`${root}/${kind==='room_type'?'room-types':kind==='room'?'rooms':'places'}`;
export function accommodationSetupCommandValid(command:RecordedCommand,body:Record<string,unknown>){
 if(command.domain!=='accommodation'||!accommodationSetupKind(command.kind)||command.path!==accommodationSetupPath(command.root,command.kind)||command.method!=='POST'||!uuid(command.sourceId)||body.command_id!==command.key||!whole(body.expected_revision,0,Number.MAX_SAFE_INTEGER)||body.id!==undefined&&body.id!==command.sourceId||body.id===undefined&&(command.sourceId!==command.key||body.expected_revision!==0)||body.id!==undefined&&body.expected_revision===0)return false;
 const fields=['command_id','expected_revision','id','active','reason',...(command.kind==='room_type'?['name','default_capacity','allocation_mode']:command.kind==='room'?['space_id','room_type_id','sleeping_capacity','allocation_mode']:['room_id','label','holding_id'])];
 if(Object.keys(body).some(k=>!fields.includes(k))||typeof body.active!=='boolean'||typeof body.reason!=='string'||body.reason.length>1000||body.id!==undefined&&body.reason.trim().length<3)return false;
 if(command.kind==='room_type')return typeof body.name==='string'&&body.name.trim().length>=2&&body.name.length<=100&&whole(body.default_capacity)&&mode(body.allocation_mode);
 if(command.kind==='room')return uuid(body.space_id)&&uuid(body.room_type_id)&&whole(body.sleeping_capacity)&&mode(body.allocation_mode);
 return uuid(body.room_id)&&typeof body.label==='string'&&body.label.trim().length>=1&&body.label.length<=100&&(body.holding_id===null||uuid(body.holding_id));
}
export function accommodationSetupResult(command:RecordedCommand,value:unknown){
 const row=value as Record<string,unknown>|null,body=JSON.parse(command.body) as Record<string,unknown>;
 if(!accommodationSetupCommandValid(command,body)||!row||row.id!==command.sourceId||row.revision!==Number(body.expected_revision)+1)return false;
 // Exact owning receipt or concrete owning DTO returned by the command.
 if(row.kind!==undefined)return row.kind===command.kind;
 if(command.kind==='room_type')return typeof row.name==='string'&&whole(row.default_capacity)&&mode(row.allocation_mode)&&typeof row.active==='boolean';
 if(command.kind==='room'){const space=row.space as {id?:unknown}|null,type=row.room_type as {id?:unknown}|null;return space?.id===body.space_id&&type?.id===body.room_type_id&&whole(row.sleeping_capacity)&&mode(row.allocation_mode)&&Array.isArray(row.places);}
 return typeof row.label==='string'&&typeof row.active==='boolean'&&(row.holding===null||uuid((row.holding as {id?:unknown}|null)?.id));
}
export function accommodationTypeBody(current:RoomType|undefined,values:{name:string;capacity:string;mode:AllocationMode;active:boolean;reason:string}){const body={...(current?{id:current.id}:{}),expected_revision:current?.revision??0,name:values.name.trim(),default_capacity:Number(values.capacity),allocation_mode:values.mode,active:values.active,reason:values.reason.trim()};if(!/^\d+$/.test(values.capacity)||!whole(body.default_capacity)||body.name.length<2||body.name.length>100||current&&body.reason.length<3)throw new Error('Review the type name, whole sleeping capacity and reason.');return body;}
export function accommodationRoomBody(current:AccommodationRoom|undefined,values:{spaceId:string;typeId:string;capacity:string;mode:AllocationMode;active:boolean;reason:string},options:AccommodationOptions){if(!options.can_manage||!uuid(values.spaceId)||current&&current.space.id!==values.spaceId||!options.room_types.some(t=>t.id===values.typeId&&t.active)||!/^\d+$/.test(values.capacity)||!whole(Number(values.capacity))||current&&values.reason.trim().length<3)throw new Error('Review the current canonical room, active type, sleeping capacity and reason.');return{...(current?{id:current.id}:{}),expected_revision:current?.revision??0,space_id:values.spaceId,room_type_id:values.typeId,sleeping_capacity:Number(values.capacity),allocation_mode:values.mode,active:values.active,reason:values.reason.trim()};}
export function accommodationPlaceBody(room:AccommodationRoom,current:RoomPlace|undefined,values:{label:string;holdingId:string;active:boolean;reason:string},options:AccommodationOptions){if(!options.can_manage||!uuid(room.id)||values.label.trim().length<1||values.label.trim().length>100||current&&(!room.places.some(p=>p.id===current.id&&p.revision===current.revision)||values.reason.trim().length<3)||values.holdingId&&current?.holding?.id!==values.holdingId&&!options.holdings.some(h=>h.id===values.holdingId)||!current&&(!room.active||room.allocation_mode!=='shared'))throw new Error('Review the exact shared room, named place and optional existing bed item.');return{...(current?{id:current.id}:{}),expected_revision:current?.revision??0,room_id:room.id,label:values.label.trim(),holding_id:values.holdingId||null,active:values.active,reason:values.reason.trim()};}
