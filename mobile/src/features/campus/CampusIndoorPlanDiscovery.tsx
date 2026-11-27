import { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { CampusSceneElement, CampusSceneSpace } from '../../../../packages/contracts/src/campus-scenes/types';
import { apiFetch } from '../../lib/api';
import { useOperationContext } from '../../lib/use-operation-context';
import { Button, Field, Notice, Section } from '../../ui/components';
import { Disclosure } from '../../ui/DomainControls';

type PlanCandidate = { url: string; title: string; source_host: string };
type Discovery = { status:'found'|'not_found'|'unavailable'; candidates:PlanCandidate[]; reason?:string };
function safeCandidate(candidate:PlanCandidate):boolean {
  try {
    const url=new URL(candidate.url);
    return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&url.hostname===candidate.source_host
      && typeof candidate.title==='string' && candidate.title.length>0;
  } catch { return false; }
}

export function CampusIndoorPlanDiscovery({schoolId,campusId,building,floor,spaces,disabled,hidden,onImportPlan}:{
  schoolId:string; campusId:string; building:CampusSceneElement; floor?:CampusSceneSpace;
  spaces:readonly CampusSceneSpace[]; disabled:boolean; hidden:boolean; onImportPlan:()=>void;
}) {
  const buildingPlace=spaces.find(place=>place.id===building.space_id);
  const capture=useOperationContext(JSON.stringify([schoolId,campusId,building.id,floor?.id,'public-plan-lookup']));
  const [site,setSite]=useState(''),[result,setResult]=useState<Discovery>(),[pending,setPending]=useState(false),[error,setError]=useState('');
  const request=useRef(false),first=useRef(false);
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
      setResult({...value,candidates:value.candidates.filter(safeCandidate).slice(0,5)});
    }catch(cause){setError(cause instanceof Error?cause.message:'The public plan search could not finish.');}
    finally{request.current=false;setPending(false);}
  }
  useEffect(()=>{
    if(!first.current&&!hidden&&!disabled&&buildingPlace?.revision){first.current=true;void find();}
  },[disabled,hidden,buildingPlace?.revision]);
  if (hidden) return null;
  return <Disclosure key={result?.candidates.length?'found':'sources'} defaultOpen={!!result?.candidates.length} title={result?.candidates.length?'Public floor plans found':'Floor-plan sources'}>
    <Section title="Plans for this building">
      {pending?<Notice message="Checking for a public floor plan…"/>:null}
      {error?<Notice tone="warning" message={error}/>:null}
      {result?.candidates.length?<>
        <Notice message="Check that the plan shows the right floor and that you have permission to adapt it."/>
        {result.candidates.map(candidate=><Button key={candidate.url} title={candidate.title} kind="secondary" disabled={disabled}
          onPress={()=>void Linking.openURL(candidate.url).catch(()=>setError('This public plan link could not be opened.'))}/>)}
      </>:result&&!pending?<Notice message={result.status==='unavailable'?(result.reason??'Public plan search is unavailable.'):'No matching public plan was found. You can describe this floor below.'}/>:null}
      <Field label="Official campus website (optional)" value={site} onChangeText={setSite} maxLength={240} editable={!disabled&&!pending} autoCapitalize="none"/>
      <Button title="Find a public floor plan" kind="secondary" disabled={disabled||pending} onPress={()=>void find(site)}/>
      <Button title="Use an authorized plan file" kind="secondary" disabled={disabled} onPress={onImportPlan}/>
    </Section>
  </Disclosure>;
}
