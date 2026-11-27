import { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { CampusSceneElement, CampusSceneSpace } from '../../../../packages/contracts/src/campus-scenes/types';
import { apiFetch } from '../../lib/api';
import { useOperationContext } from '../../lib/use-operation-context';
import { CAMPUS_A2UI_BASIC_CATALOG } from '../../lib/campus-a2ui';
import { Alert } from '../../ui/Alert';
import { Button, Field, Notice, Section } from '../../ui/components';
import { Disclosure } from '../../ui/DomainControls';
import { CampusA2uiSurface } from './CampusA2uiSurface';

type PlanCandidate = { url: string; title: string; source_host: string; source_id?: string; floor_label?: string };
type Discovery = { status:'found'|'not_found'|'unavailable'; candidates:PlanCandidate[]; reason?:string };
export type PublicFloorPlanRequest = { sourceId: string; buildingId: string; floorId?: string; floorLabel?: string; officialWebsite?: string };
function safeCandidate(candidate:PlanCandidate):boolean {
  try {
    const url=new URL(candidate.url);
    return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&url.hostname===candidate.source_host
      && typeof candidate.title==='string' && candidate.title.length>0 && candidate.title.length<=160
      && (candidate.source_id===undefined||typeof candidate.source_id==='string'&&/^[-a-z0-9]{1,100}$/u.test(candidate.source_id))
      && (candidate.floor_label===undefined||typeof candidate.floor_label==='string'&&candidate.floor_label.trim().length>=2&&candidate.floor_label.length<=160);
  } catch { return false; }
}

export function CampusIndoorPlanDiscovery({schoolId,campusId,building,floor,spaces,disabled,hidden,onImportPlan,onUsePlan}:{
  schoolId:string; campusId:string; building:CampusSceneElement; floor?:CampusSceneSpace;
  spaces:readonly CampusSceneSpace[]; disabled:boolean; hidden:boolean; onImportPlan:()=>void;
  onUsePlan:(request:PublicFloorPlanRequest)=>Promise<void>;
}) {
  const buildingPlace=spaces.find(place=>place.id===building.space_id);
  const capture=useOperationContext(JSON.stringify([schoolId,campusId,building.id,floor?.id,'public-plan-lookup']));
  const [site,setSite]=useState(''),[result,setResult]=useState<Discovery&{officialWebsite?:string}>(),[pending,setPending]=useState(false),[error,setError]=useState('');
  const request=useRef(false),first=useRef(false),confirming=useRef(false);
  async function find(website?:string) {
    if(disabled||request.current||!buildingPlace?.revision||floor&&!floor.revision)return;
    request.current=true;setPending(true);setError('');
    try {
      const check=capture();
      const root=`/api/v1/schools/${encodeURIComponent(schoolId)}/campus-scenes/${encodeURIComponent(campusId)}/imports/floor-plan-discovery/`;
      const value=await apiFetch<Discovery>(root,{method:'POST',body:JSON.stringify({
        idempotency_key:Crypto.randomUUID(),
        target:{building_id:buildingPlace.id,expected_building_revision:buildingPlace.revision,
          ...(floor?{floor_id:floor.id,expected_floor_revision:floor.revision}:{})},
        ...(website?{official_website:website.trim()}:{}),
      })});
      check();
      if(!value||!Array.isArray(value.candidates)||!['found','not_found','unavailable'].includes(value.status))throw new Error('The plan search returned an unreadable result.');
      setResult({...value,candidates:value.candidates.filter(safeCandidate).slice(0,5),...(website?{officialWebsite:website.trim()}:{})});
    }catch(cause){setError(cause instanceof Error?cause.message:'The public plan search could not finish.');}
    finally{request.current=false;setPending(false);}
  }
  useEffect(()=>{
    if(!first.current&&!hidden&&!disabled&&buildingPlace?.revision){first.current=true;void find();}
  },[hidden,disabled,buildingPlace?.revision]);
  if(hidden)return null;
  const candidates=result?.candidates??[];
  const confirm=(candidate:PlanCandidate)=>{
    if(disabled||request.current||confirming.current||!buildingPlace||!candidate.source_id)return;
    let check:()=>void;
    try{check=capture();}catch{return;}
    const choice:PublicFloorPlanRequest={sourceId:candidate.source_id,buildingId:buildingPlace.id,
      ...(floor?{floorId:floor.id}:{}),...(candidate.floor_label?{floorLabel:candidate.floor_label}:{}),
      ...(result?.officialWebsite?{officialWebsite:result.officialWebsite}:{})};
    confirming.current=true;
    const cancel=()=>{confirming.current=false;};
    Alert.alert('Use this public floor plan?',`Confirm you have permission to use and adapt “${candidate.title}”. ThatCampus will copy it into your private campus workspace for review.`,[
      {text:'Cancel',style:'cancel',onPress:cancel},
      {text:'I have permission. Use plan',onPress:()=>{
        cancel();
        try{check();}catch{return;}
        void onUsePlan(choice).catch(cause=>setError(cause instanceof Error?cause.message:'The public floor plan could not be prepared.'));
      }},
    ],{cancelable:true,onDismiss:cancel});
  };
  const messages=[{version:'1.0',createSurface:{surfaceId:'public-floor-plans',catalogId:CAMPUS_A2UI_BASIC_CATALOG,components:[
    {id:'root',component:'Column',children:candidates.map((_,index)=>`source-${index}`)},
    ...candidates.flatMap((candidate,index)=>[
      {id:`source-${index}`,component:'Column',children:[`title-${index}`,`open-${index}`,...(candidate.source_id?[`use-${index}`]:[])]},
      {id:`title-${index}`,component:'Text',text:candidate.title},
      {id:`open-${index}`,component:'Button',child:`open-label-${index}`,variant:'borderless',
        action:{event:{name:'open_floor_plan_source',context:{index}}}},
      {id:`open-label-${index}`,component:'Text',text:`Open source on ${candidate.source_host}`},
      ...(candidate.source_id?[
        {id:`use-${index}`,component:'Button',child:`use-label-${index}`,variant:'primary',
          action:{event:{name:'use_public_floor_plan',context:{index}}}},
        {id:`use-label-${index}`,component:'Text',text:`Use ${candidate.floor_label??candidate.title} plan`},
      ]:[]),
    ]),
  ]}}];
  return <Disclosure key={result?.candidates.length?'found':'sources'} defaultOpen={!!result?.candidates.length} title={result?.candidates.length?'Public floor plans found':'Floor-plan sources'}>
    <Section title="Plans for this building">
      {pending?<Notice message="Checking for a public floor plan…"/>:null}
      {error?<Notice tone="warning" message={error}/>:null}
      {result?.candidates.length?<>
        <Notice message="Check that the plan shows the right floor and that you have permission to adapt it."/>
        <CampusA2uiSurface messages={messages} disabled={disabled||pending} onAction={({action})=>{
          const index=action.context.index;
          const candidate=typeof index==='number'&&Number.isSafeInteger(index)?candidates[index]:undefined;
          if(!candidate)return;
          if(action.name==='use_public_floor_plan')confirm(candidate);
          if(action.name==='open_floor_plan_source')void Linking.openURL(candidate.url).catch(()=>setError('This public plan link could not be opened.'));
        }}/>
      </>:result&&!pending?<Notice message={result.status==='unavailable'?(result.reason??'Public plan search is unavailable.'):'No matching public plan was found. You can describe this floor below.'}/>:null}
      <Field label="Official campus website (optional)" value={site} onChangeText={setSite} maxLength={240} editable={!disabled&&!pending} autoCapitalize="none"/>
      <Button title="Find a public floor plan" kind="secondary" disabled={disabled||pending} onPress={()=>void find(site)}/>
      <Button title="Use an authorized plan file" kind="secondary" disabled={disabled} onPress={onImportPlan}/>
    </Section>
  </Disclosure>;
}
