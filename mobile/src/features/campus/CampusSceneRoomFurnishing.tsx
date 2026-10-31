import { useState } from 'react';
import { ROOM_FURNISHING_TEMPLATES, type RoomFurnishingTemplate } from '../../../../packages/contracts/src/campus-scenes/sceneRoomTemplates';
import { Button, Notice } from '../../ui/components';
import { ChoiceMenu, Disclosure } from '../../ui/DomainControls';

export function CampusSceneRoomFurnishing({existingCount,disabled,relativeScale=false,onApply}:{existingCount:number;disabled:boolean;relativeScale?:boolean;onApply:(template:RoomFurnishingTemplate)=>void}){
 const [template,setTemplate]=useState<RoomFurnishingTemplate>('office'),[alongside,setAlongside]=useState(false);
 return <Disclosure title="Furnish this room"><Notice message="Start with an editable arrangement. This adds illustration objects; link recorded inventory separately."/>{relativeScale?<Notice message="This plan has no measured scale. Furniture sizes and spacing fit illustratively inside the room."/>:null}<ChoiceMenu label="Room arrangement" value={template} options={ROOM_FURNISHING_TEMPLATES.map(item=>({value:item.key,label:item.label}))} disabled={disabled} onChange={value=>{setTemplate(value as RoomFurnishingTemplate);setAlongside(false);}}/><Notice message={`${ROOM_FURNISHING_TEMPLATES.find(item=>item.key===template)?.description}. Items that cannot fit inside the room are left out.`}/>{existingCount?<Button title={alongside?`Add alongside ${existingCount} existing objects: confirmed`:`Confirm adding alongside ${existingCount} existing objects`} kind={alongside?'primary':'secondary'} disabled={disabled} onPress={()=>setAlongside(!alongside)}/>:null}<Button title="Add editable furniture" disabled={disabled||!!existingCount&&!alongside} onPress={()=>{if(disabled||existingCount&&!alongside)return;onApply(template);setAlongside(false);}}/></Disclosure>;
}
