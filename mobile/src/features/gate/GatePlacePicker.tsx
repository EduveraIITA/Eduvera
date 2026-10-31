import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { VisitOptions, VisitPlace } from '../../../../packages/contracts/src/wire/features/gate/visitApi';
import { useSession } from '../../auth/SessionProvider';
import { apiFetch } from '../../lib/api';
import { useOperationContext } from '../../lib/use-operation-context';
import { filterVisitPlaces, placeCategories, visitPlaceContexts, type PlaceCategory, type VisitTimeWindow, visitPlaceSchedule } from '../../lib/visit-place-presentation';
import { ScreenBack, useScreenExitGuard } from '../../ui/BackNavigation';
import { ChoiceMenu, ControlButton } from '../../ui/DomainControls';
import { Empty, ListGroup, Loading, Notice, Row, SearchField, Section } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { DomainPages } from '../ResourcesScreen';
import { CampusPlacePortal } from './CampusPlacePortal';
import { useVisitCampuses, useVisitPlaces, useVisitSchedule } from './useVisitPlaces';

export function GatePlacePicker({root,disabled,onClose,onSelected,window,campusChoices=[]}:{campusChoices?:VisitPlace[];root:string;disabled?:boolean;onClose():void;onSelected(value:VisitPlace):void;window?:VisitTimeWindow}) {
  const session=useSession(),{colors}=useTheme(),catalogue=useVisitPlaces(root),campuses=useVisitCampuses(session.schoolId!),schedule=useVisitSchedule(session.schoolId!,window),capture=useOperationContext(`${root}/place-picker`);
  const contexts=useMemo(()=>visitPlaceContexts(campuses.error?[]:campuses.data?.publications??[]),[campuses.data,campuses.error]);
  const [search,setSearch]=useState(''),[category,setCategory]=useState<PlaceCategory>('all'),[page,setPage]=useState(1),[visual,setVisual]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState('');
  const current=useRef({mounted:false,disabled,working});Object.assign(current.current,{disabled,working});
  useEffect(()=>{current.current.mounted=true;return()=>{current.current.mounted=false;};},[]);
  const locked=!!disabled||working;
  useScreenExitGuard({blocked:working});
  const choose=async(candidate:VisitPlace)=>{
    if(current.current.disabled||current.current.working)return;current.current.working=true;setWorking(true);setError('');
    try{const assertCurrent=capture();const data=await apiFetch<VisitOptions>(`${root}/options/?${new URLSearchParams({[candidate.kind==='campus'?'campus_id':'place_id']:candidate.id})}`);assertCurrent();
      if(!current.current.mounted||current.current.disabled)return;
      const found=(candidate.kind==='campus'?data.campuses??[]:data.places).filter(row=>row.id===candidate.id&&row.kind===candidate.kind);if(found.length!==1)throw new Error('This place is no longer an eligible destination. Refresh its current choices.');
      setVisual(false);onSelected(found[0]!);
    }catch(cause){if(current.current.mounted)setError(cause instanceof Error?cause.message:'This destination could not be confirmed.');}
    finally{current.current.working=false;if(current.current.mounted)setWorking(false);}
  };
  const places=!catalogue.error&&catalogue.data?[...campusChoices,...catalogue.data]:undefined,matches=filterVisitPlaces(places??[],category,search,contexts),pages=Math.max(1,Math.ceil(matches.length/10)),shown=Math.min(page,pages);
  return <Section title="Choose meeting place"><ScreenBack title="Back to visit form" priority={30} onPress={onClose} preservesDraft/>
    <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><ChoiceMenu label="Place category" value={category} disabled={locked||!places||campuses.isPending} options={placeCategories.map(value=>({...value,label:`${value.label}${places&&!campuses.isPending?` · ${filterVisitPlaces(places,value.value,'',contexts).length}`:''}`}))} onChange={value=>{setCategory(value as PlaceCategory);setPage(1);}}/><ControlButton title="Choose on campus" disabled={locked} onPress={()=>setVisual(true)}/></View>
    <SearchField label="Find a place" placeholder="Name, kind or campus" value={search} disabled={locked||!places} onChangeText={value=>{setSearch(value.slice(0,100));setPage(1);}} onClear={()=>{setSearch('');setPage(1);}}/>
    {catalogue.isPending?<><Loading/><Text style={{color:colors.muted,fontSize:14,lineHeight:21}}>Loading the complete place catalogue for category browsing…</Text></>:!places?<Empty title="Place choices unavailable" message={catalogue.error?.message} onRetry={()=>void catalogue.refetch()}/>:<>
      <Text style={{color:colors.muted,fontSize:14,lineHeight:21}}>{matches.length} matching {matches.length===1?'place':'places'}</Text>
      {matches.length?<ListGroup inset>{matches.slice((shown-1)*10,shown*10).map((place,index)=>{const context=contexts.get(place.id),status=visitPlaceSchedule(context?.footprint??[place.id],schedule.error||place.kind==='campus'&&(!context||context.footprint.length<2)?undefined:schedule.data?.items,window,schedule.data?.complete);return <Row key={place.id} title={place.label} detail={context?.detail??[place.kind.replaceAll('_',' '),place.campus_label].filter(Boolean).join(' · ')} icon={context?.category==='rooms'?'entryPoints':context?.category==='outdoors'||place.kind==='campus'?'campus':'building'} variant="plain" separator={index>0} status={window?`${status.label}${place.kind==='campus'?' · mapped places':''}`:undefined} statusTone={status.tone} onPress={locked?undefined:()=>void choose(place)}/>;})}</ListGroup>:<Empty title="No matching places" message="Try another category or search. The filter covers the complete current catalogue."/>}
      {pages>1?<DomainPages page={shown} hasMore={shown<pages} disabled={locked} onChange={setPage}/>:null}
    </>}
    {window?<Text style={{color:colors.muted,fontSize:14,lineHeight:21}}>Schedule checks cover published timetable activities for the visit window. Other bookings are not certified, and choosing a destination does not reserve it.</Text>:<Text style={{color:colors.muted,fontSize:14,lineHeight:21}}>Set the visit's start and end times to check published schedule conflicts.</Text>}
    {error?<Notice tone="warning" message={error}/>:null}
    {visual&&session.schoolId?<CampusPlacePortal campusChoices={campusChoices} schoolId={session.schoolId} window={window} disabled={locked} onClose={()=>setVisual(false)} onChoose={value=>void choose(value)}/>:null}
  </Section>;
}
