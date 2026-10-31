import { useEffect, useRef, useState } from 'react';
import type { CollectorDeparture, CollectorTrip } from '../../../packages/contracts/src/wire/features/departure/api';
import { useSession } from '../auth/SessionProvider';
import { apiFetch } from '../lib/api';
import type { DepartureWrite } from '../lib/use-departure-command';
import { useOperationContext } from '../lib/use-operation-context';
import { ScreenBack, useScreenExitGuard } from '../ui/BackNavigation';
import { ControlButton } from '../ui/DomainControls';
import { Field, Notice, Section } from '../ui/components';
import { collectorCancellationAvailable, collectorCancellationBody, collectorCancellationFingerprint } from './DepartureJourneyPolicy';

export function DepartureCancellation({href,trip,write,disabled=false}:{href:string;trip:CollectorTrip;write:DepartureWrite;disabled?:boolean}) {
  const {user,schoolId}=useSession(),[source,setSource]=useState<CollectorTrip|null>(null),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),running=useRef(false);
  const capture=useOperationContext(JSON.stringify([href,trip.id,'collector-cancellation']));
  const locked=disabled||write.locked||busy;
  useEffect(()=>{if(source&&!write.busy&&!write.action&&write.accepted?.source?.kind==='transport_collector_cancellation'&&write.accepted.source.sourceId===source.id&&write.accepted.source.revision===source.revision){setSource(null);setNote('');}},[write.accepted,write.busy,write.action,source]);
  useScreenExitGuard({blocked:busy||write.busy,dirty:!!source&&!write.pending,title:'Leave journey cancellation?',message:'Your unsent cancellation reason will be discarded.',onLeave:()=>{setSource(null);setNote('');}});
  const cancel=async()=>{
    if(!source||!user||!schoolId||locked||running.current)return;
    running.current=true;setBusy(true);setError('');
    try {
      const check=capture(),current=await apiFetch<CollectorDeparture>('/api/v1/departure/collector/');check();
      const body=collectorCancellationBody(source,current,user.id,schoolId,note);
      const ok=await write.run(`/api/v1/departure/trips/${source.id}/actions/cancel/`,body,{source:{kind:'transport_collector_cancellation',sourceId:source.id,revision:source.revision}});check();
      if(ok){setSource(null);setNote('');}
    }catch(cause){setError(cause instanceof Error?cause.message:'The cancellation could not be confirmed.');}
    finally{running.current=false;setBusy(false);}
  };
  if(!source)return user&&schoolId&&collectorCancellationAvailable(trip,user.id,schoolId)?<ControlButton title="Cancel journey" kind="danger" disabled={locked} onPress={()=>{setSource(structuredClone(trip));setNote('');setError('');}}/>:null;
  return <Section title="Cancel this journey"><ScreenBack title="Keep journey" priority={20} disabled={busy||write.busy} onPress={()=>setSource(null)}/>
    <Notice tone="warning" message="Families will see the cancellation. Campus operations must arrange an alternative departure. No learner’s physical departure or handover is recorded by this action."/>
    {error?<Notice tone="danger" message={error}/>:null}
    {collectorCancellationFingerprint(source)!==collectorCancellationFingerprint(trip)?<><Notice tone="warning" message="The journey changed during this review. Your reason is kept. Review the current journey and riders before confirming."/>{user&&schoolId&&collectorCancellationAvailable(trip,user.id,schoolId)?<ControlButton title="Review current journey for cancellation" disabled={locked} onPress={()=>{setSource(structuredClone(trip));setError('');}}/>:null}</>:null}
    <Field label="Cancellation reason" value={note} onChangeText={setNote} multiline maxLength={500} editable={!locked}/>
    <ControlButton title="Keep journey" disabled={busy||write.busy} onPress={()=>setSource(null)}/>
    <ControlButton title="Confirm cancellation" kind="danger" busy={busy||write.busy} disabled={locked||note.trim().length<3||collectorCancellationFingerprint(source)!==collectorCancellationFingerprint(trip)} onPress={()=>void cancel()}/>
  </Section>;
}
