import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { ReviewedScenePlaceRow } from '../../../../packages/contracts/src/campus-scenes/contracts';
import type { CampusSceneDocument, CampusSceneElement, CampusScenePoint, CampusSceneSpace } from '../../../../packages/contracts/src/campus-scenes/types';
import { scenePointBounds } from '../../../../packages/contracts/src/campus-scenes/sceneGeometry';
import { floorPlanReviewedRows } from '../../../../packages/contracts/src/campus-scenes/sceneFloorPlans';
import { scenePlaceCode, scenePlaceKinds, type ScenePlaceKind } from '../../../../packages/contracts/src/campus-scenes/scenePlaceProposals';
import { campusSceneFloorBelongsToBuilding } from '../../lib/campus-scene-inspector';
import { indoorContains, indoorResourcePin, indoorRoomCorners } from '../../lib/campus-indoor-pins';
import { parseCampusIndoorDescription, parseCampusIndoorRoomResources } from '../../lib/campus-indoor-description';
import { apiFetch } from '../../lib/api';
import { useOperationContext } from '../../lib/use-operation-context';
import { useScreenExitGuard } from '../../ui/BackNavigation';
import { Button, Empty, Field, Notice, Section } from '../../ui/components';
import { ChoiceMenu } from '../../ui/DomainControls';
import { Alert } from '../../ui/Alert';
import { CampusIndoorCounselor, type CampusIndoorItemReview, type CampusIndoorPin, type CampusIndoorPrompt, type CampusIndoorRoomReview } from './CampusIndoorCounselor';
import { CampusIndoorPlanDiscovery, type PublicFloorPlanRequest } from './CampusIndoorPlanDiscovery';
import { CampusMapCanvas, initialCampusCamera } from './CampusMapCanvas';
import { CampusSetupWorkspace } from './CampusSetupWorkspace';
import { CampusSceneResourcePicker } from './CampusSceneResourcePicker';
import { campusInteriorBuildings, findCampusInteriorBuilding } from './campus-copilot-targets';

type IndoorItem = CampusIndoorItemReview & { elementIds: string[]; individualPins?: boolean };
type IndoorRoom = Omit<CampusIndoorRoomReview, 'items'> & { items: IndoorItem[] };
export type CampusIndoorSave = { document: CampusSceneDocument; rows: ReviewedScenePlaceRow[] };
type Props = {
  document: CampusSceneDocument; spaces: readonly CampusSceneSpace[]; schoolId: string; campusId: string;
  contextKey: string; aiAvailable: boolean; autoOpenAssistant?: boolean; requestedBuilding?: string | null;
  initialBuildingId?: string | null; initialFloorId?: string | null; disabled: boolean; busy: boolean; feedback?: ReactNode;
  onClose: () => void; onImportPlan: (buildingId: string) => void;
  onSave: (value: CampusIndoorSave) => Promise<void>;
  onUsePublicPlan: (request: PublicFloorPlanRequest) => Promise<void>;
  onEditingChange?: (editing: boolean) => void;
};

export function CampusIndoorMapping(props: Props) {
  const buildings = campusInteriorBuildings(props.document, props.spaces);
  const [buildingId,setBuildingId]=useState(() => {
    if (props.requestedBuilding != null) return findCampusInteriorBuilding(buildings,props.spaces,props.requestedBuilding)?.id??'';
    const focused = buildings.find(building => building.space_id===props.initialBuildingId);
    return focused?.id??(props.autoOpenAssistant&&buildings.length>1?'':buildings[0]?.id??'');
  });
  const building = buildings.find(element => element.id === buildingId);
  const floors = props.spaces.filter(place => building?.space_id && place.status!=='inactive' && campusSceneFloorBelongsToBuilding(place,building.space_id,props.spaces));
  const [floorChoice,setFloorChoice]=useState<{ buildingId:string; floorId:string|null }>();
  const floorId = floorChoice?.buildingId===buildingId ? floorChoice.floorId : floors.find(item=>item.id===props.initialFloorId)?.id??floors[0]?.id??null;
  const floor = floors.find(place => place.id===floorId);
  const buildingPicker = <ChoiceMenu label="Building" value={buildingId} options={buildings.map(item=>({value:item.id,label:item.label}))}
    onChange={setBuildingId} disabled={props.disabled}/>;
  if (!building && buildings.length) return <CampusSetupWorkspace campusName={props.document.name} phase="interior"
    map={<View style={{padding:24,gap:12}}>
      <Empty title="Choose a building" message={props.requestedBuilding == null
        ? 'Select a building to check for its floor plans and start mapping.'
        : 'The requested name did not identify one mapped building. Select the building you want to use.'}/>
      {buildingPicker}
    </View>}
    options={[]} onClose={props.onClose} />;
  if (!building) return <CampusSetupWorkspace campusName={props.document.name} phase="interior" map={
    <Empty title="Connect a building before mapping inside" message="Set up facilities on the campus map to choose a building."/>}
    options={[]} onClose={props.onClose} />;
  return <IndoorFloor key={`${buildingId}:${floorId??'new'}`} {...props} building={building} floor={floor}
    selector={<>{buildingPicker}
    <ChoiceMenu label="Floor" value={floorId??''}
      options={[...floors.map(item=>({value:item.id,label:item.name})),{value:'',label:'Add a floor'}]}
      onChange={value=>setFloorChoice({buildingId,floorId:value||null})} disabled={props.disabled}/></>}
  />;
}

function savedRooms(document: CampusSceneDocument, floor: CampusSceneSpace | undefined, spaces: readonly CampusSceneSpace[]): IndoorRoom[] {
  if (!floor) return [];
  return document.elements.filter(element=>element.kind==='room'&&element.floor_id===floor.id).map(room=>{
    const raw = spaces.find(place=>place.id===room.space_id)?.kind;
    const kind = scenePlaceKinds(room).find(value=>value===raw)??null;
    const items = document.elements.filter(element=>element.kind==='fixture'&&element.floor_id===floor.id&&element.parent_element_id===room.id)
      .map(item=>({id:item.id,name:item.label,quantity:1,pinned:true,elementIds:[item.id]}));
    return {id:room.id,name:room.label,kind,pinned:true,linked:!!room.space_id,items};
  });
}

function IndoorFloor({building,floor,selector,...props}: Props & {
  building:CampusSceneElement; floor?:CampusSceneSpace; selector:ReactNode;
}) {
  const floorId = floor?.id ?? null;
  const [draft,setDraft]=useState(props.document),[baseline]=useState(props.document);
  const [rooms,setRooms]=useState(()=>savedRooms(props.document,floor,props.spaces));
  const [name,setName]=useState(floor?.name??'Ground floor'),[answer,setAnswer]=useState('');
  const [pin,setPin]=useState<CampusIndoorPin|null>(null),[corner,setCorner]=useState<CampusScenePoint|null>(null);
  const [camera,setCamera]=useState(initialCampusCamera),[selected,setSelected]=useState<string|null>(null);
  const [feedback,setFeedback]=useState(''),[warnings,setWarnings]=useState<string[]>([]);
  const [describing,setDescribing]=useState<string|null>(null);
  const describedRoom=rooms.find(room=>room.id===describing);
  const saving = useRef(false), promptRequest = useRef(0);
  const [aiPrompt,setAiPrompt]=useState<CampusIndoorPrompt>();
  const capture=useOperationContext(JSON.stringify([props.contextKey,props.schoolId,props.campusId,building.id,floorId,'indoor-guidance']));
  const baselineIds = new Set(baseline.elements.map(element=>element.id));
  const newIds = draft.elements.filter(element=>!baselineIds.has(element.id)).map(element=>element.id);
  const dirty = draft!==baseline;
  const editing = dirty || !!pin || !!answer.trim() || name!==(floor?.name??'Ground floor')
    || rooms.some(room=>!room.pinned||room.items.some(item=>!item.pinned));
  const reportEditing = props.onEditingChange;
  useLayoutEffect(()=>{
    reportEditing?.(editing);
    return ()=>reportEditing?.(false);
  },[editing,reportEditing]);
  const outline = building.geometry.points;
  const imageBounds = scenePointBounds(outline);
  useScreenExitGuard({blocked:props.busy,dirty:editing,title:'Leave indoor mapping?',message:'Save your pins before leaving if you want to keep them.'});

  function reviseRoom(id:string,patch:Partial<IndoorRoom>) {
    setRooms(previous=>previous.map(room=>room.id===id?{...room,...patch}:room));
    if (patch.name) renameElements([id],patch.name);
  }
  function renameElements(ids:readonly string[],label:string) {
    if (!ids.length || !label.trim()) return;
    setDraft(previous=>({...previous,elements:previous.elements.map(element=>ids.includes(element.id)
      ? {...element, label:label.trim().slice(0,160),review_state:'needs_review'} : element)}));
  }
  async function askNext(rooms: readonly IndoorRoom[], request:number) {
    const place=props.spaces.find(value=>value.id===building.space_id);
    if (!props.aiAvailable || !place?.revision || (floor && !floor.revision)) return;
    const check=capture(), items=rooms.flatMap(room=>room.items).filter(item=>!item.pinned);
    try {
      const root=`/api/v1/schools/${encodeURIComponent(props.schoolId)}/campus-scenes/${encodeURIComponent(props.campusId)}/imports/indoor-guidance/`;
      const result=await apiFetch<{prompt:{question:string;hint?:string}|null}>(root,{method:'POST',body:JSON.stringify({
        idempotency_key:Crypto.randomUUID(),
        target:{building_id:place.id,expected_building_revision:place.revision,
          ...(floor?{floor_id:floor.id,expected_floor_revision:floor.revision}:{})},
        progress:{rooms:rooms.length,unplaced_rooms:rooms.filter(room=>!room.pinned).length,unplaced_items:items.length,
          uncertain_counts:items.filter(item=>item.quantity===null).length},
      })});
      check();
      if (request===promptRequest.current && result.prompt) setAiPrompt({id:`follow-up-${request}`,...result.prompt,optional:true});
    } catch { /* The local guide already has a current prompt. */ }
  }
  function parse(text:string, inAssistant:boolean) {
    if (describedRoom) {
      const result=parseCampusIndoorRoomResources(text);
      if (!result.resources.length) throw new Error(result.warnings[0]??'Describe an item in this room, such as two fans or a bookshelf.');
      const items=result.resources.map(item=>({id:Crypto.randomUUID(),name:item.name,quantity:item.quantity,elementIds:[]}));
      reviseRoom(describedRoom.id,{items:[...describedRoom.items,...items.filter(item=>!describedRoom.items.some(old=>old.name.toLowerCase()===item.name.toLowerCase()))].slice(0,32)});
      setWarnings(result.warnings.slice(0,5));setAnswer('');
      return;
    }
    const result=parseCampusIndoorDescription(text,{defaultFloorName:name});
    const target=result.floors.find(item=>item.name.toLowerCase()===name.toLowerCase())
      ?? (!floor && result.floors.length===1 ? result.floors[0] : undefined);
    const reminders=[...result.warnings];
    if (result.floors.some(item=>item!==target)) reminders.push('Switch to the other floor to map its rooms.');
    if (!target?.rooms.length) throw new Error(reminders[0]??'Describe a room by name, then add any items you know.');
    if (!floor && !dirty) setName(target.name);
    const suggestions=target.rooms.flatMap(room=>Array.from({length:Math.min(20,room.quantity)},(_,index)=>({
      id:Crypto.randomUUID(),name:room.quantity>1?`${room.name} ${index+1}`:room.name,kind:room.kind,
      items:room.resources.slice(0,24).map(item=>({id:Crypto.randomUUID(),name:item.name,quantity:item.quantity,elementIds:[]})),
    } satisfies IndoorRoom))).slice(0,40);
    const next=[...rooms];
    for(const suggestion of suggestions){
      const match=next.findIndex(room=>room.name.trim().toLowerCase()===suggestion.name.trim().toLowerCase());
      if(match<0){if(next.length<40)next.push(suggestion);continue;}
      const room=next[match]!;
      next[match]={...room,items:[...room.items,...suggestion.items.filter(item=>!room.items.some(old=>old.name.toLowerCase()===item.name.toLowerCase()))].slice(0,32)};
    }
    setRooms(next);setWarnings(reminders.slice(0,5));setAnswer('');
    setAiPrompt(undefined);
    if (inAssistant) void askNext(next,++promptRequest.current).catch(()=>{});
  }
  function placePoint(point:CampusScenePoint) {
    if (!pin || props.disabled) return;
    setFeedback('');
    try {
      const proposed=rooms.find(room=>room.id===pin.roomId);
      if(!proposed)throw new Error('Choose a room back in the guide.');
      if(!pin.itemId) {
        if(!indoorContains(point,outline))throw new Error('Tap inside this building to mark the room.');
        if(!corner){setCorner(point);return;}
        const points=indoorRoomCorners(corner,point,building);
        const prior=draft.elements.find(element=>element.id===proposed.id);
        if(prior&&draft.elements.some(element=>element.parent_element_id===prior.id&&element.geometry.points.some(existing=>!indoorContains(existing,points)))){
          throw new Error('The new outline must still contain this room’s mapped items.');
        }
        const room:CampusSceneElement={...prior,id:proposed.id,kind:'room',label:proposed.name.trim().slice(0,160),floor_id:floorId,
          space_id:prior?.space_id??null,parent_element_id:building.id,geometry:{type:'polygon',points},review_state:'needs_review'};
        if(room.label.length<2)throw new Error('Give this room a name before drawing it.');
        storeElement(room);reviseRoom(proposed.id,{pinned:true});setPin(null);setCorner(null);return;
      }
      const item=proposed.items.find(value=>value.id===pin.itemId),room=draft.elements.find(element=>element.id===proposed.id);
      if(!item||!room||!item.name.trim())throw new Error('Name the item and outline its room before pinning it.');
      const count=item.quantity??1,individualPins=pin.individually||item.individualPins,group=count>20&&!individualPins,required=group?1:count;
      const replacing=item.elementIds.length>=required;
      const id=replacing?item.elementIds[0]!:Crypto.randomUUID();
      const label=group?`${count} × ${item.name}`:required>1?`${item.name} ${replacing?1:item.elementIds.length+1}`:item.name;
      const prior=draft.elements.find(element=>element.id===id);
      const element=indoorResourcePin(draft,building,floorId,room,point,label,id);
      storeElement(prior?{...prior,label:element.label,geometry:element.geometry,review_state:'needs_review'}:element);
      const elementIds=replacing?item.elementIds:[...item.elementIds,id],pinned=elementIds.length>=required;
      reviseRoom(proposed.id,{items:proposed.items.map(value=>value.id===item.id?{...value,elementIds,pinned,individualPins}:value)});
      if(pinned){setPin(null);setCorner(null);}
      else setFeedback(`Placed ${elementIds.length} of ${required}. Tap the next location in this room.`);
    } catch(cause) { setFeedback(cause instanceof Error ? cause.message : 'This point could not be mapped.'); }
  }
  function storeElement(element:CampusSceneElement) {
    const exists=draft.elements.some(value=>value.id===element.id);
    if(!exists&&draft.elements.length>=2000)throw new Error('This layout has reached its limit of 2,000 features.');
    setDraft({...draft,elements:exists?draft.elements.map(value=>value.id===element.id?element:value):[...draft.elements,element]});
    setSelected(element.id);
  }
  async function save() {
    if (!dirty || props.disabled || saving.current) return;
    saving.current=true;
    try {
      const codes=new Set(props.spaces.map(place=>place.code.toUpperCase()));
      const rows:ReviewedScenePlaceRow[]=rooms.filter(room=>room.pinned&&newIds.includes(room.id)).map((room,index)=>{
        const element=draft.elements.find(value=>value.id===room.id)!;
        const kind=room.kind&&scenePlaceKinds(element).includes(room.kind)?room.kind:'other';
        return {proposal_id:`room_${index+1}`,element_ids:[room.id],action:'create',name:element.label,kind,code:scenePlaceCode(element.label,index,codes)};
      });
      const newRoomIds=new Set(rows.flatMap(row=>row.element_ids));
      const floorElementIds=floorId?draft.elements.filter(element=>newRoomIds.has(element.id)||(
        !baselineIds.has(element.id)&&element.parent_element_id&&newRoomIds.has(element.parent_element_id))).map(element=>element.id):newIds;
      const result=floorElementIds.length?floorPlanReviewedRows({
        buildingId:building.space_id!,buildingElementId:building.id,floorId,
        ...(!floorId?{newFloor:{name,code:''}}:{}),elementIds:floorElementIds,imageBounds,
      },rows,props.spaces):{rows:[],errors:[]};
      if(result.errors.length)throw new Error(result.errors[0]);
      await props.onSave({document:draft,rows:result.rows});
    } finally {saving.current=false;}
  }
  const close=()=>{if(props.busy)return;if(!editing){props.onClose();return;}Alert.alert('Pause indoor mapping?', 'Keep mapping or discard the unsaved details on this floor.', [
    {text:'Keep mapping',style:'cancel'},{text:'Discard edits',style:'destructive',onPress:props.onClose},
    ...(dirty?[{text:'Save and pause',onPress:()=>void save().catch(cause=>setFeedback(cause instanceof Error?cause.message:'Could not save this floor.'))}]:[]),
  ]);};
  const tapTarget=rooms.find(room=>room.id===pin?.roomId);
  const selectedElement=draft.elements.find(element=>element.id===selected);
  const linksInUse=new Set(draft.elements.filter(element=>element.id!==selected&&element.holding_id).map(element=>element.holding_id!));
  const describeRoom=(id:string)=>{
    if (answer.trim() && id!==describing) {setFeedback('Submit or clear the current description before switching rooms.');return;}
    ++promptRequest.current;setAiPrompt(undefined);setWarnings([]);setFeedback('');setDescribing(id);setSelected(id);
  };
  const changeHolding=(id:string|null)=>{
    if (props.disabled||selectedElement?.kind!=='fixture')return;
    storeElement({...selectedElement,holding_id:id,review_state:'needs_review'});
  };
  const importPlan=()=>{if(editing){setFeedback('Save or discard your indoor edits before opening a source plan.');return;}props.onImportPlan(building.space_id!);};
  return <CampusSetupWorkspace campusName={`${building.label} · ${name}`} phase="interior" onClose={close}
    options={[{label:'Use a floor-plan file',run:importPlan}]} locked={props.busy} feedback={props.feedback}
    autoOpenAssistant={props.autoOpenAssistant}
    map={<CampusMapCanvas scene={draft} contextKey={props.contextKey} draftPreview includeSurroundings={false}
      floor={floorId} mode="2d" selected={selected} camera={camera} onCameraChange={setCamera} route={null} unavailable={[]}
      onSelect={setSelected} editorInterior={{buildingId:building.space_id!,buildingElementId:building.id,floorId,elementIds:newIds,imageBounds}}
      onPoint={pin?placePoint:undefined} drawingPoints={pin&&corner?[corner]:undefined} />}
    guidance={<>
      {!editing?selector:null}
      {!pin&&!floor?<Field label="Floor name" value={name} onChangeText={setName} maxLength={160} editable={!props.disabled}/>:null}
      {feedback?<Notice tone="warning" message={feedback}/>:null}
      {warnings.map((warning,index)=><Notice key={index} message={warning}/>)}
      {pin&&!pin.itemId?<Notice message={corner?`Tap the opposite corner of ${tapTarget?.name??'the room'}.`:'Tap the first of two opposite room corners.'}/>:null}
      {pin?<Button title="Finish pin placement" kind="secondary" onPress={()=>{setPin(null);setCorner(null);setFeedback('');}}/>:null}
      {!pin&&selectedElement?.kind==='fixture'?<CampusSceneResourcePicker schoolId={props.schoolId} campusId={props.campusId}
        holdingId={selectedElement.holding_id??null} linkedElsewhere={linksInUse} disabled={props.disabled} onChange={changeHolding}/>:null}
    </>}
    assistantGuidance={pin?undefined:(backToMap,inAssistant)=><>
      <CampusIndoorPlanDiscovery {...{schoolId:props.schoolId,campusId:props.campusId,building,floor,spaces:props.spaces}}
        disabled={props.disabled} hidden={editing} onImportPlan={importPlan} onUsePlan={props.onUsePublicPlan}/>
      <CampusIndoorCounselor floorName={name} answer={answer} onAnswerChange={value=>{
          if(value && !answer)++promptRequest.current;
          setAnswer(value);
        }} onAnswer={text=>parse(text,inAssistant)}
        prompt={describedRoom?{id:`describe-room-${describedRoom.id}`,question:`What is in ${describedRoom.name}?`,
          hint:'Describe any items you want to pin, such as two fans, a bookshelf, or four ceiling lights.',optional:true}:aiPrompt??{id:'describe-floor',question:rooms.length?'What else should we map on this floor?':'What rooms are on this floor?',
          hint:rooms.length?'Mention the room name and any details, such as two fans, a light, or 30 books.':'For example: The ground floor has a library and an office. The library has two fans.'}}
        onSkipPrompt={()=>{++promptRequest.current;setDescribing(null);setAiPrompt(undefined);}}
        onDescribeRoom={describeRoom} rooms={rooms.map(room=>({...room,items:room.items.map(item=>({...item,quantityLocked:item.elementIds.length>0}))}))} onEditRoom={(id,patch)=>reviseRoom(id,patch)}
        onEditItem={(roomId,itemId,patch)=>{
          const room=rooms.find(value=>value.id===roomId),item=room?.items.find(value=>value.id===itemId);
          if(!room||!item)return;
          if(patch.name)renameElements(item.elementIds,patch.name);
          reviseRoom(roomId,{items:room.items.map(value=>value.id===itemId?{...value,...patch,...(value.elementIds.length?{quantity:value.quantity}:{})}:value)});
        }}
        activePin={pin} onPin={value=>{setPin(value);setCorner(null);setFeedback('');if(value){setSelected(value.roomId);backToMap();}}}
        canSave={dirty} onSave={async()=>{await save();backToMap();}} onPause={()=>{backToMap();close();}} disabled={props.disabled} busy={props.busy}/>
    </>}/>;
}
