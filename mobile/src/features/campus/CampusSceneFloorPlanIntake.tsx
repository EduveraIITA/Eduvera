import { useEffect, useRef, useState } from 'react';
import { Image } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { CampusSceneDocument, CampusSceneImportCapabilities, CampusSceneSpace } from '../../../../packages/contracts/src/campus-scenes/types';
import type { NativePendingFile } from '../../lib/native-pending-action';
import { attendancePhotoFileMetadata } from '../../lib/attendance-photo';
import { campusSceneDefinitiveImportFailure, campusSceneFloorBelongsToBuilding, campusSceneFloorIntake, type NativeFloorPlanIntakeRequest } from '../../lib/campus-scene-inspector';
import { pickPrivateFile, privateFilePreview, readPrivateFile, removePrivateFile } from '../../lib/private-file';
import { useOperationContext } from '../../lib/use-operation-context';
import { ScreenBack, useScreenExitGuard } from '../../ui/BackNavigation';
import { Button, Empty, Field, Notice, Section } from '../../ui/components';
import { ChoiceMenu, ControlButton, Disclosure } from '../../ui/DomainControls';

export type { NativeFloorPlanIntakeRequest } from '../../lib/campus-scene-inspector';
export interface CampusSceneFloorPlanIntakeProps {href:string;document:CampusSceneDocument;spaces:readonly CampusSceneSpace[];initialBuildingId?:string|null;capabilities?:CampusSceneImportCapabilities;disabled?:boolean;onPrepare:(request:NativeFloorPlanIntakeRequest)=>Promise<void>;onClose:()=>void}

/** The form owns picked originals; the command journal retains a separate immutable copy. */
export function CampusSceneFloorPlanIntake({href,document,spaces,initialBuildingId,capabilities,disabled=false,onPrepare,onClose}:CampusSceneFloorPlanIntakeProps){
 const buildings=spaces.filter(space=>space.status!=='inactive'&&document.elements.some(element=>element.kind==='building'&&element.space_id===space.id));
 const [buildingId,setBuildingId]=useState(()=>buildings.some(space=>space.id===initialBuildingId)?initialBuildingId!:buildings[0]?.id??'');
 const floors=spaces.filter(space=>space.status!=='inactive'&&campusSceneFloorBelongsToBuilding(space,buildingId,spaces));
 const [floorId,setFloorId]=useState(()=>floors[0]?.id??''),[floorName,setFloorName]=useState('Ground floor'),[floorCode,setFloorCode]=useState(''),[file,setFile]=useState<NativePendingFile|null>(null),[preview,setPreview]=useState<string|null>(null),[rights,setRights]=useState(false),[instructions,setInstructions]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[terminalFailure,setTerminalFailure]=useState(false);
 const inFlight=useRef(false),alive=useRef(true),selectedFile=useRef<NativePendingFile|null>(null);selectedFile.current=file;
 const capture=useOperationContext(JSON.stringify([href,buildingId,floorId,'floor-plan-intake']));
 const maxImageBytes=capabilities?.max_image_bytes??4*1024*1024,analysisAvailable=capabilities?.image_analysis.available===true,locked=disabled||busy;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;const current=selectedFile.current;if(current)void removePrivateFile(current.uri).catch(()=>{});};},[]);
 useEffect(()=>{let current=true,release:(()=>void)|undefined;setPreview(null);if(file)void privateFilePreview(file.uri).then(value=>{if(!current){value.release();return;}release=value.release;setPreview(value.uri);}).catch(cause=>{if(current)setError(cause instanceof Error?cause.message:'The private plan preview could not load.');});return()=>{current=false;release?.();};},[file?.uri]);
 useScreenExitGuard({dirty:!!file,blocked:busy,title:'Leave floor-plan intake?',message:'The unprepared image selection and notes will be discarded.'});
 let request:NativeFloorPlanIntakeRequest|null=null;try{request=campusSceneFloorIntake(document,spaces,{file,buildingId,floorId,floorName,floorCode,instructions,rights,traceOnly:!analysisAvailable},maxImageBytes);}catch{/* The fielded choices remain editable until complete. */}
 const choose=async()=>{if(locked||inFlight.current)return;inFlight.current=true;setBusy(true);setError('');let picked:Awaited<ReturnType<typeof pickPrivateFile>>=null;try{
  const assertCurrent=capture();picked=await pickPrivateFile(['image/png','image/jpeg','image/webp'],maxImageBytes);assertCurrent();if(!picked)return;
  const mime=picked.type.toLowerCase();if(!['image/png','image/jpeg','image/webp'].includes(mime))throw new Error('Choose a PNG, JPEG or WebP floor plan.');
  const content=await readPrivateFile(picked.uri,maxImageBytes);assertCurrent();if(!content.size||content.size>maxImageBytes)throw new Error('This floor plan exceeds the current image limit.');
  const metadata=attendancePhotoFileMetadata(picked.name,mime,content.bytes);
  const digest=await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,content.bytes);assertCurrent();
  const next:NativePendingFile={uri:picked.uri,...metadata,hash:Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('')},previous=selectedFile.current;
  if(!alive.current)throw new Error('The floor-plan intake closed.');selectedFile.current=next;setFile(next);setRights(false);setTerminalFailure(false);picked=null;
  if(previous)await removePrivateFile(previous.uri).catch(()=>{});
 }catch(cause){if(picked)await removePrivateFile(picked.uri).catch(()=>{});if(alive.current)setError(cause instanceof Error?cause.message:'The private floor plan could not be opened.');}finally{inFlight.current=false;if(alive.current)setBusy(false);}};
 const prepare=async(traceOnly=false)=>{if(locked||!file||inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setTerminalFailure(false);try{
  const assertCurrent=capture(),original=file,body=campusSceneFloorIntake(document,spaces,{file:original,buildingId,floorId,floorName,floorCode,instructions,rights,traceOnly:traceOnly||!analysisAvailable},maxImageBytes),content=await readPrivateFile(original.uri,maxImageBytes);assertCurrent();
  attendancePhotoFileMetadata(original.name,original.type,content.bytes);
  const hash=Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,content.bytes)),value=>value.toString(16).padStart(2,'0')).join('');assertCurrent();if(content.size!==original.size||hash!==original.hash)throw new Error('The selected private floor plan changed. Choose it again before preparing.');
  // The controller stages its own copy before dispatch; keep this original for
  // an explicit tracing fallback until the form closes or the file is replaced.
  await onPrepare(body);
 }catch(cause){if(alive.current){setTerminalFailure(campusSceneDefinitiveImportFailure(cause));setError(cause instanceof Error?cause.message:'This floor plan could not be prepared. The campus layout is unchanged.');}}finally{inFlight.current=false;if(alive.current)setBusy(false);}};
 return <Section title="Add a floor plan"><ScreenBack title="Back to campus drawing" priority={30} disabled={busy} onPress={onClose}/>{!buildings.length?<Empty title="Connect a building in the campus drawing first" message="A floor plan fits inside one existing mapped building."/>:<>
  <Notice message="Choose a floor and upload its plan. Review the proposed rooms together before creating campus places."/><ChoiceMenu label="Building" value={buildingId} options={buildings.map(space=>({value:space.id,label:space.name}))} disabled={locked} onChange={value=>{setBuildingId(value);setFloorId(spaces.find(space=>space.status!=='inactive'&&campusSceneFloorBelongsToBuilding(space,value,spaces))?.id??'');setError('');}}/><ChoiceMenu label="Floor" value={floorId} options={[...floors.map(space=>({value:space.id,label:space.name})),{value:'',label:'Create a floor with these rooms'}]} disabled={locked} onChange={value=>{setFloorId(value);setError('');}}/>{!floorId?<Field label="New floor name" value={floorName} maxLength={160} editable={!locked} onChangeText={setFloorName}/>:null}
  <Button title={file?'Choose another floor-plan image':'Choose floor-plan image'} disabled={locked} busy={busy} onPress={()=>void choose()}/><Notice message={`${file?.name??'PNG, JPEG or WebP'} · Up to ${Math.floor(maxImageBytes/1024/1024)} MiB${file?` · ${Math.ceil(file.size/1024)} KiB selected`:''}`}/>{preview?<Image accessibilityLabel="Selected private floor plan for review" source={{uri:preview}} resizeMode="contain" style={{width:'100%',height:220}}/>:null}
  <Button title={rights?'Permission to use and adapt this plan: confirmed':'I have permission to use and adapt this floor plan'} kind={rights?'primary':'secondary'} disabled={locked||!file} onPress={()=>setRights(!rights)}/><Disclosure title="Details that help · optional"><Field label="Notes about this plan" value={instructions} maxLength={1000} multiline editable={!locked} placeholder="Reception at the bottom; the central area is a corridor." onChangeText={setInstructions}/>{!floorId?<Field label="Floor code · optional" value={floorCode} maxLength={40} editable={!locked} autoCapitalize="characters" placeholder="Suggested automatically if left blank" onChangeText={setFloorCode}/>:null}</Disclosure>
  {!analysisAvailable?<Notice message={`${capabilities?.image_analysis.reason??'Image analysis is unavailable.'} Use the same editor to trace this plan.`}/>:null}{error?<Notice tone="warning" message={error}/>:null}{terminalFailure?<Notice message="The previous analysis may have used an allowance. Start a new attempt when ready, or trace the plan instead."/>:null}<Disclosure title="What happens next"><Notice message="The plan fits inside the selected building as an editable proposal. Check its position, names and openings. Furniture remains illustrative until linked to recorded resources. Publication is a separate decision."/></Disclosure>
  {error&&analysisAvailable&&file&&rights?<ControlButton title="Trace plan instead" disabled={locked||!request} onPress={()=>void prepare(true)}/>:null}<Button title={terminalFailure?'Start a new attempt':analysisAvailable?'Find rooms in this plan':'Use plan as tracing guide'} disabled={locked||!request} busy={busy} onPress={()=>void prepare()}/>
 </>}</Section>;
}
