import { useEffect, useRef, useState } from 'react';
import { gateSharedVisitTime } from './GateSharedVisitPolicy';
import { View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { ArrangedVisit, VisitDetail, VisitOptions, VisitPerson, VisitPlace } from '../../../packages/contracts/src/wire/features/gate/visitApi';
import type { useGateCommand } from '../lib/gate-command';
import { apiFetch } from '../lib/api';
import { useApi } from '../lib/query';
import { visitEditorBody } from '../lib/visit-editor';
import { useOperationContext } from '../lib/use-operation-context';
import { useOperationClock } from '../lib/use-operation-clock';
import { diningFold, diningInput, diningInstant } from '../../../packages/contracts/src/dining-time';
import { ScreenBack, useScreenExitGuard } from '../ui/BackNavigation';
import { Alert } from '../ui/Alert';
import { ChoiceMenu, ControlButton, Facts } from '../ui/DomainControls';
import { Button, Empty, Field, ListGroup, Loading, Notice, Row, SearchField, Section, usePageScroll } from '../ui/components';
import { DomainPages, DomainText } from './ResourcesScreen';
import { DiningCampusTimeField } from './DiningTimeFields';
import { NativePeopleCreate, NativePeopleBulkCreate } from './PeopleScreen';
import { GatePlacePicker } from './gate/GatePlacePicker';
import type { VisitTimeWindow } from '../lib/visit-place-presentation';
export function GateVisitEditor({root,initial:incoming,write,onClose}:{root:string;initial?:ArrangedVisit;write:ReturnType<typeof useGateCommand>;onClose():void}){
 const initial=useRef(incoming).current;
 const clock=useOperationClock(`${root}/edit/${initial?.id??'new'}`),capture=useOperationContext(`${root}/edit/${initial?.id??'new'}`),[current,setCurrent]=useState(initial),[mode,setMode]=useState<'person'|'guest'>(initial?.person?'person':'guest'),[person,setPerson]=useState(initial?.person??null),[guest,setGuest]=useState(initial?.guest_name??''),[party,setParty]=useState(String(initial?.party_size??1)),[title,setTitle]=useState(initial?.title??''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[startFold,setStartFold]=useState(''),[endFold,setEndFold]=useState(''),[place,setPlace]=useState(initial?.place??null),[contact,setContact]=useState(initial?.contact??null),[choosing,setChoosing]=useState<'person'|'contact'|'place'|null>(null),[error,setError]=useState(''),[preparing,setPreparing]=useState(false),pending=useRef(false);
 const params=new URLSearchParams({...person?{person_id:person.id}:{},...contact?{contact_person_id:contact.id}:{},...place?{[place.kind==='campus'?'campus_id':'place_id']:place.id}:{}}),options=useApi<VisitOptions>(`${root}/options/?${params}`),responsible=contact??(options.data?.actor?{id:options.data.actor.person_id,label:options.data.actor.label,revision:options.data.actor.revision}:null),zone=options.data?.timezone??'';
 useEffect(()=>{try{if(zone&&(initial||clock.now)){setStart(v=>v||diningInput(initial?.starts_at??clock.now,zone));setStartFold(v=>v||(initial?diningFold(initial.starts_at,zone):''));if(initial){setEnd(v=>v||diningInput(initial.ends_at,zone));setEndFold(v=>v||diningFold(initial.ends_at,zone));}}}catch{setError('The campus timezone could not be verified.');}},[zone,clock.now]);
 const dirty=title!==(initial?.title??'')||guest!==(initial?.guest_name??'')||person?.id!==initial?.person?.id||party!==String(initial?.party_size??1)||!!end&&!initial||!!initial&&!!zone&&(start!==diningInput(initial.starts_at,zone)||end!==diningInput(initial.ends_at,zone)||startFold!==diningFold(initial.starts_at,zone)||endFold!==diningFold(initial.ends_at,zone))||place?.id!==initial?.place.id||place?.kind!==initial?.place.kind||contact?.id!==initial?.contact.id;
 useScreenExitGuard({blocked:write.busy||preparing,dirty:!write.pending&&dirty,onLeave:onClose});
 const mounted=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const save=async(reviewOnly=false)=>{
  if(write.locked||pending.current)return;
  pending.current=true;setPreparing(true);setError('');
  let reportCurrent:(()=>void)|undefined;
  try{
   const assertCurrent=capture();reportCurrent=assertCurrent;
   let source=current;
   if(current){
    const latest=await apiFetch<VisitDetail>(`${root}/${current.id}/`);assertCurrent();
    if(latest.visit.id!==current.id||!latest.can_edit)throw new Error('This exact visit can no longer be edited.');
    if(reviewOnly){
     await options.refetch({throwOnError:true});assertCurrent();
     setCurrent(latest.visit);
     if(latest.visit.last_movement){setMode(latest.visit.person?'person':'guest');setPerson(latest.visit.person);setGuest(latest.visit.guest_name??'');}
     scrollToTop();return;
    }
    if(latest.visit.revision!==current.revision)throw new Error('This visit changed. Your entries are kept; review its current plan.');
    source=latest.visit;
   }
   const latest=await apiFetch<VisitOptions>(`${root}/options/?${params}`);assertCurrent();
   if(latest.timezone!==zone)throw new Error('The campus timezone changed. Review these hours before saving.');
   const body=visitEditorBody(source,{mode,person,guest,party,title,startsAt:diningInstant(start,zone,startFold),endsAt:diningInstant(end,zone,endFold),place,contact:responsible},latest),commandId=Crypto.randomUUID();
   assertCurrent();
   await write.run({path:source?`${root}/${source.id}/update/`:`${root}/`,body:JSON.stringify({...body,command_id:commandId}),commandId,visitId:source?.id??commandId,label:source?'Visit changes confirmed.':'Visit arrangement confirmed.'});
  }catch(cause){
   try{reportCurrent?.();if(mounted.current&&reportCurrent)setError(cause instanceof Error?cause.message:'The visit could not be reviewed.');}catch{/* A departed account, world or editor does not receive late feedback. */}
  }finally{pending.current=false;if(mounted.current)setPreparing(false);}
 };

 const locked=write.locked||preparing,identityLocked=!!current?.last_movement,scrollToTop=usePageScroll();
 useEffect(()=>{scrollToTop();},[scrollToTop]);
 useEffect(()=>{if(choosing)scrollToTop();},[choosing,scrollToTop]);
 // Replace the form body while choosing; its draft and operation owner stay mounted.
 let visitWindow:VisitTimeWindow|undefined;try{if(start&&end&&zone)visitWindow={startsAt:diningInstant(start,zone,startFold),endsAt:diningInstant(end,zone,endFold),timezone:zone};}catch{}
 if(choosing)return <VisitChoicePicker window={visitWindow} root={root} kind={choosing==='place'?'places':'people'} disabled={locked} onClose={()=>setChoosing(null)} onSelected={value=>{if(choosing==='place')setPlace(value as VisitPlace);else if(choosing==='person')setPerson(value as VisitPerson);else setContact(value as VisitPerson);setChoosing(null);}}/>;
 return <View style={{gap:24}}><ScreenBack title={initial?'Back to visit details':'Back to visits'} priority={10} onPress={onClose}/>{options.isPending?<Loading/>:options.error||!options.data?<Empty title="Visit choices unavailable" message={options.error?.message} onRetry={()=>void options.refetch()}/>:<>
  {current&&current.revision!==initial?.revision?<Section title="Current saved plan"><Notice message="Another change was saved while you were editing. Compare this saved plan with your entries below before saving your reviewed changes."/><Facts items={[
   {label:'Visitors',value:current.person?.label??current.guest_name??current.guest_label},
   {label:'Purpose',value:current.title},{label:'People expected',value:String(current.party_size)},
   {label:'Starts',value:gateSharedVisitTime(current.starts_at,zone)},{label:'Ends',value:gateSharedVisitTime(current.ends_at,zone)},
   {label:'Destination',value:current.place.label},{label:'Campus contact',value:current.contact.label},
  ]}/></Section>:null}
  <Section title="Visitors"><ChoiceMenu label="Visitor identity" value={mode} options={[{value:'guest',label:'Guest or group'},{value:'person',label:'Campus person'}]} disabled={locked||identityLocked} onChange={value=>setMode(value as typeof mode)}/>
   {mode==='guest'?<Field label={Number(party)>1?'Group contact name':'Guest name'} value={guest} onChangeText={setGuest} maxLength={150} editable={!locked&&!identityLocked}/>:<ListGroup inset><Row title="Campus person" icon="person" variant="plain" detail={person?.label??'Choose a person'} onPress={locked||identityLocked?undefined:()=>setChoosing('person')}/></ListGroup>}
   <Field label="Visit purpose" value={title} onChangeText={setTitle} maxLength={160} editable={!locked}/><Field label="People expected" value={party} onChangeText={setParty} keyboardType="number-pad" maxLength={5} editable={!locked}/>
   {identityLocked?<Notice message="Guest identity stays with recorded movement. Updating the expected count does not change earlier observations."/>:null}
  </Section>
  <Section title="Schedule"><DiningCampusTimeField grouped label="Starts" value={start} onChange={setStart} timezone={zone} fold={startFold} onFold={setStartFold} disabled={locked}/><DiningCampusTimeField grouped label="Ends" value={end} onChange={setEnd} timezone={zone} fold={endFold} onFold={setEndFold} disabled={locked}/></Section>
  <Section title="Meeting"><ListGroup inset><Row title="Destination" icon="building" variant="plain" detail={place?.label??'Choose a place'} onPress={locked?undefined:()=>setChoosing('place')}/><Row title="Campus contact" icon="person" variant="plain" separator detail={responsible?.label??'Choose a person'} onPress={locked?undefined:()=>setChoosing('contact')}/></ListGroup></Section>
  <Notice message="This is a planned visit. It does not grant entry, reserve a room, record attendance or create a visitor account."/>
  {error?<><Notice tone="warning" message={error}/>{initial?<ControlButton title="Review current visit with these entries" disabled={locked} onPress={()=>void save(true)}/>:null}</>:null}
  <Button title={initial?current?.revision!==initial.revision?'Save reviewed visit changes':'Save visit changes':'Confirm visit'} busy={preparing||write.busy} disabled={locked||!end||!start||!place||!responsible||!title.trim()||mode==='guest'&&!guest.trim()||mode==='person'&&!person} onPress={()=>void save()}/>
 </>}{clock.error?<Notice tone="warning" message={clock.error}/>:null}</View>;

}
export function VisitChoicePicker({root,kind,disabled,onClose,onSelected,href,allowAdd=false,window}:{root:string;kind:'people'|'places';disabled?:boolean;onClose():void;onSelected(value:VisitPerson|VisitPlace):void;href?:string;allowAdd?:boolean;window?:VisitTimeWindow}){
 const[search,setSearch]=useState(''),[submitted,setSubmitted]=useState(''),[page,setPage]=useState(1),[adding,setAdding]=useState<'one'|'many'|null>(null),[error,setError]=useState(''),[reviewing,setReviewing]=useState(false),query=useApi<VisitOptions>(`${root}/options/?${new URLSearchParams({q:submitted,page:String(page)})}`),capture=useOperationContext(`${root}/choice/${kind}`);
 const addingEpoch=useRef(0),currentAdding=useRef(adding);currentAdding.current=adding;
 const changeAdding=(value:typeof adding)=>{addingEpoch.current++;currentAdding.current=value;setAdding(value);};
 const closeAdding=()=>{
  const mode=currentAdding.current,epoch=addingEpoch.current;if(!mode)return;
  let assertCurrent:()=>void;try{assertCurrent=capture();}catch(cause){setError(cause instanceof Error?cause.message:'Return to this original person form to continue.');return;}
  Alert.alert('Close this person form?','Any unsaved person details will be discarded. Your visit entries stay here.',[
   {text:'Keep editing',style:'cancel'},
   {text:'Discard person entries',style:'destructive',onPress:()=>{try{assertCurrent();if(currentAdding.current!==mode||addingEpoch.current!==epoch)return;changeAdding(null);}catch{/* A stale confirmation cannot close a different form or world. */}}},
  ]);
 };
 const acceptCreated=async(people:{id:string}[])=>{changeAdding(null);setError('');if(people.length!==1){await query.refetch();return;}setReviewing(true);try{const assertCurrent=capture(),latest=await apiFetch<VisitOptions>(`${root}/options/?${new URLSearchParams({person_id:people[0]!.id})}`);assertCurrent();const found=latest.people.find(p=>p.id===people[0]!.id);if(!found)throw new Error('This person is not available for this visit. Choose a current eligible person.');onSelected(found);}catch(cause){setError(cause instanceof Error?cause.message:'The created person could not be selected.');}finally{setReviewing(false);}};
 if(kind==='places')return <GatePlacePicker campusChoices={query.data?.campuses} root={root} disabled={disabled} onClose={onClose} onSelected={onSelected} window={window}/>;
 return <Section title={kind==='people'?'Choose person':'Choose meeting place'}><ScreenBack title={adding?'Back to choices':'Back to visit form'} priority={30} onPress={adding?closeAdding:onClose} preservesDraft/>{adding&&href?adding==='one'?<NativePeopleCreate href={href} onClose={()=>changeAdding(null)} onCreated={person=>void acceptCreated([person])}/>:<NativePeopleBulkCreate href={href} onClose={()=>changeAdding(null)} onDone={people=>void acceptCreated(people)}/>:<><SearchField label="Find choice" placeholder={kind==='people'?'Find a person':'Find a place'} value={search} onChangeText={setSearch} onSubmit={()=>{setSubmitted(search.trim());setPage(1);}} disabled={disabled||reviewing}/>{allowAdd&&kind==='people'&&href?<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><ControlButton title="Add person" disabled={disabled||reviewing} onPress={()=>changeAdding('one')}/><ControlButton title="Add or import people" disabled={disabled||reviewing} onPress={()=>changeAdding('many')}/></View>:null}{query.isPending||reviewing?<Loading/>:query.error||!query.data?<Empty title="Choices unavailable" message={query.error?.message} onRetry={()=>void query.refetch()}/>:<>{query.data[kind].length?<ListGroup inset>{query.data[kind].map((choice,index)=><Row key={choice.id} title={choice.label} icon={kind==='people'?'person':'building'} variant="plain" separator={index>0} onPress={disabled||reviewing?undefined:()=>onSelected(choice)}/>)}</ListGroup>:null}<DomainPages page={page} hasMore={kind==='people'?query.data.pagination.people_has_more:query.data.pagination.places_has_more} disabled={disabled} onChange={setPage}/>{!query.data[kind].length?<DomainText>No matching current choices.</DomainText>:null}</>}{error?<Notice tone="warning" message={error}/>:null}</>}</Section>;
}
