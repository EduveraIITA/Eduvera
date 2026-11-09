import React from 'react';
import { Switch,Text,View } from 'react-native';
import type { ExamRoomAllocationDraft } from '../../lib/assessment-authoring';
import { Field,Notice,Row,Section } from '../../ui/components';
import { ChoiceMenu,ControlButton,Disclosure } from '../../ui/DomainControls';
import { useTheme } from '../../ui/theme';

type Room = {id:string;name:string;capacity?:number|null|undefined};
type Staff = {id:string;first_name:string;last_name:string};

export function ExamRoomAllocationsEditor({ rooms,spaces,staff,disabled,candidateCount,onChange }: {
  rooms:ExamRoomAllocationDraft[];spaces:Room[];staff:Staff[];disabled:boolean;candidateCount?:number|undefined;
  onChange(rooms:ExamRoomAllocationDraft[]):void;
}) {
  const {colors}=useTheme();
  const total=rooms.reduce((sum,room)=>sum+Number(room.candidates||0),0);
  const used=new Set(rooms.map(room=>room.space));
  const remaining=spaces.some(space=>!used.has(space.id)&&Number(space.capacity)>0);
  const update=(index:number,patch:Partial<ExamRoomAllocationDraft>)=>{
    onChange(rooms.map((room,position)=>position===index?{...room,...patch}:room));
  };
  return <Section title="Room allocations">
    <Notice message={candidateCount===undefined
      ? 'Candidates use these room counts in roster order. The roster is frozen when you schedule.'
      : `${total} of ${candidateCount} candidates allocated for the saved examination date. Candidates are assigned in roster order when you schedule.`} />
    {rooms.map((room,index)=>{
      const occupied=new Set(rooms.filter((_,position)=>index!==position).flatMap(item=>item.invigilators));
      const eligible=staff.filter(person=>!occupied.has(person.id)||room.invigilators.includes(person.id));
      return <Disclosure key={index} title={`Room ${index+1} · ${spaces.find(space=>space.id===room.space)?.name??'Choose room'}`}>
        <ChoiceMenu label={`Room ${index+1} or hall`} value={room.space}
          options={spaces.filter(space=>space.id===room.space||!used.has(space.id)&&Number(space.capacity)>0)
            .map(space=>({value:space.id,label:`${space.name} · ${space.capacity??'No recorded'} seats`}))}
          onChange={space=>update(index,{space})} disabled={disabled} />
        <Field label={`Candidates in room ${index+1}`} value={room.candidates} onChangeText={candidates=>update(index,{candidates})}
          keyboardType="number-pad" maxLength={5} editable={!disabled} />
        <Text style={{color:colors.muted}}>Invigilators · {room.invigilators.length} selected</Text>
        {eligible.map(person=><View key={person.id} style={{flexDirection:'row',alignItems:'center',gap:12}}>
          <Switch accessibilityLabel={`Room ${index+1} invigilator: ${person.first_name} ${person.last_name}`}
            disabled={disabled} value={room.invigilators.includes(person.id)} onValueChange={selected=>update(index,{
              invigilators:selected?[...room.invigilators,person.id]:room.invigilators.filter(id=>id!==person.id),
            })} />
          <Text style={{color:colors.ink,fontSize:16,flex:1}}>{person.first_name} {person.last_name}</Text>
        </View>)}
        {index>0&&rooms.length>2?<ControlButton title={`Remove room ${index+1}`} disabled={disabled}
          onPress={()=>onChange(rooms.filter((_,position)=>position!==index))} />:null}
      </Disclosure>;
    })}
    {rooms.length<12&&remaining?<ControlButton title="Add another room" disabled={disabled}
      onPress={()=>onChange([...rooms,{space:'',candidates:'',invigilators:[]}])} />:null}
    <ControlButton title="Use one room" disabled={disabled} onPress={()=>onChange([])} />
  </Section>;
}

export function ExamRoomAllocationsReview({ rooms,spaces,staff }: {
  rooms:ExamRoomAllocationDraft[];spaces:Room[];staff:Staff[];
}) {
  return <Section title="Room allocations">
    {rooms.map(room=><Row key={room.space} variant="plain" title={spaces.find(space=>space.id===room.space)?.name??'Room'}
      detail={`${room.candidates} candidates · ${room.invigilators.map(id=>staff.find(person=>person.id===id))
        .filter((person):person is Staff=>Boolean(person)).map(person=>`${person.first_name} ${person.last_name}`).join(', ')}`} />)}
  </Section>;
}
