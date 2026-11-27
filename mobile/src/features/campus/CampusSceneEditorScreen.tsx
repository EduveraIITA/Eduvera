import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useOperatingPaneDimensions } from '../../ui/OperatingPane';
import * as Crypto from 'expo-crypto';
import type { CampusSceneImage, CampusSceneReceipt, CampusSceneWorkspace, ReviewedScenePlacesRequest } from '../../../../packages/contracts/src/campus-scenes/contracts';
import type { CampusSceneDocument, CampusSceneElement, CampusSceneLocation, CampusScenePoint, CampusSceneSpace, CampusSceneImportCapabilities } from '../../../../packages/contracts/src/campus-scenes/types';
import type { CampusSpace, InstitutionSetup } from '../../../../packages/contracts/src/institution';
import { CAMPUS_SCENE_ASSETS } from '../../../../packages/contracts/src/campus-scenes/sceneAssets';
import { clampPoint, defaultPoints, draftIssues, geometryType, moveElement } from '../../../../packages/contracts/src/campus-scenes/sceneEditing';
import { mergeFloorPlanProposal, type SceneFloorPlanContext } from '../../../../packages/contracts/src/campus-scenes/sceneFloorPlans';
import { furnishSceneRoom, type RoomFurnishingTemplate } from '../../../../packages/contracts/src/campus-scenes/sceneRoomTemplates';
import { sceneOnboardingReadiness } from '../../../../packages/contracts/src/campus-scenes/sceneSetupReadiness';
import type { ScenePlaceKind } from '../../../../packages/contracts/src/campus-scenes/scenePlaceProposals';
import { scenePlaceFocus } from '../../../../packages/contracts/src/campus-scenes/scenePlaceCamera';
import { useSession } from '../../auth/SessionProvider';
import { apiFetch, getApiOrigin } from '../../lib/api';
import { useApi } from '../../lib/query';
import { canResumeCampusMapSetup, canStartCampusMapSetup, campusSceneEditorFocus, campusSceneGuideIntent, campusSceneSourceState, nativeSceneDocument } from '../../lib/campus-scene-policy';
import { applyCampusMapHints, assistedFacilityReview, campusMapAssistance, type CampusMapAssistance } from '../../lib/campus-map-assistance';
import { useSceneHistory } from '../../lib/campus-scene-history';
import { useNativePendingAction, type NativePendingAction, type NativePendingFile, type NativePendingInput } from '../../lib/native-pending-action';
import { shareCampusDraft } from '../../lib/share-local-document';
import { useOperationContext } from '../../lib/use-operation-context';
import { useNativeSceneLighting } from '../../lib/native-scene-lighting';
import { Alert } from '../../ui/Alert';
import { ScreenBack, useScreenExitGuard } from '../../ui/BackNavigation';
import { Button, Empty, Field, Loading, Notice, Page, Row, SearchField, Section } from '../../ui/components';
import { ChoiceMenu, ControlButton, Disclosure, SegmentedControl } from '../../ui/DomainControls';
import { DomainPages, DomainText, LabeledSwitch, domainHref, domainParams, type DomainScreenProps } from '../ResourcesScreen';
import { NativePlaceCreate } from '../CanonicalSpaceCreate';
import { CampusMapCanvas, initialCampusCamera } from './CampusMapCanvas';
import { CampusSceneInspector } from './CampusSceneInspector';
import { CampusSceneSourceIntake, type NativeCampusSourceRequest } from './CampusSceneSourceIntake';
import { CampusScenePlaceBatchReview, type CampusScenePlaceReview } from './CampusScenePlaceBatchReview';
import { CampusSceneFloorPlanIntake, type NativeFloorPlanIntakeRequest } from './CampusSceneFloorPlanIntake';
import { CampusSceneRoomFurnishing } from './CampusSceneRoomFurnishing';
import { useCampusSceneImage } from './useCampusSceneImage';
import { CampusAreaMap, type CampusAreaPoint } from './CampusAreaMap';
import { CampusMapAreaReview, canGuideCampusFacilities, type CampusMapReviewHint, type CampusMapReviewHints } from './CampusMapAreaReview';
import { CampusSetupWorkspace } from './CampusSetupWorkspace';
import { CampusControl } from './CampusWorkspace';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { MinusIcon } from 'phosphor-react-native/src/icons/Minus';
import { CrosshairSimpleIcon } from 'phosphor-react-native/src/icons/CrosshairSimple';

export const emptyNativeScene=(name:string):CampusSceneDocument=>({schema_version:1,name,bounds:{width:1000,height:800,unit:'relative'},source:{kind:'manual',label:'Manually drawn campus'},elements:[]});
type CampusSceneEditorProps = DomainScreenProps & {
 schoolId: string; campusId: string; mapFirst?: boolean;
 onChooseCampus?: () => void; onViewPublished?: () => void;
};
export function CampusSceneEditorScreen({href,onNavigate,schoolId,campusId,mapFirst,onChooseCampus,onViewPublished}:CampusSceneEditorProps){
 const session=useSession(),identity=JSON.stringify([session.scopeKey,schoolId,campusId]),root=`/api/v1/schools/${encodeURIComponent(schoolId)}/campus-scenes/${encodeURIComponent(campusId)}/`,query=useApi<CampusSceneWorkspace>(root+'workspace/'),lastKnown=useRef<{identity:string;workspace:CampusSceneWorkspace}|null>(null);
 if(query.data?.campus.id===campusId)lastKnown.current={identity,workspace:query.data};
 const workspace=lastKnown.current?.identity===identity?lastKnown.current.workspace:null;
 if(!workspace&&query.isPending)return <Page title="Campus layout"><Loading/></Page>;
 if(!workspace)return <Page title="Campus layout"><Empty title="This campus draft could not be confirmed" message={query.error?.message} onRetry={()=>void query.refetch()}/></Page>;
 const sourceError=query.error?.message??(query.data?.campus.id!==campusId?'The current campus source could not be confirmed.':'');
 return <NativeSceneEditor key={identity} {...{href,onNavigate,schoolId,campusId,root,sourceError,mapFirst,onChooseCampus,onViewPublished}} workspace={workspace} reload={async()=>{const result=await query.refetch({throwOnError:true});if(!result.data||result.data.campus.id!==campusId)throw new Error('The refreshed source belongs to another campus.');return result.data;}}/>;
}
function NativeSceneEditor({href,onNavigate,schoolId,campusId,root,workspace,reload,sourceError,mapFirst,onChooseCampus,onViewPublished}:CampusSceneEditorProps & {root:string;workspace:CampusSceneWorkspace;sourceError:string;reload():Promise<CampusSceneWorkspace>}){
 const session=useSession(),client=useQueryClient(),capture=useOperationContext(JSON.stringify([href,schoolId,campusId])),{height,width}=useOperatingPaneDimensions();
 const history=useSceneHistory(workspace.scene?.draft??workspace.scene?.published?.document??emptyNativeScene(workspace.campus.name));
 const guide=campusSceneGuideIntent(href);
 const initialFocus=useRef(campusSceneEditorFocus(history.document,guide?.element??domainParams(href).get('element_id'))).current;
 const document=history.document,current=useRef(document),knownRevision=useRef(workspace.scene?.revision??0);current.current=document;knownRevision.current=Math.max(knownRevision.current,workspace.scene?.revision??0);
 const initialPanel=guide?.panel??(!guide&&!initialFocus.selected
   ? canStartCampusMapSetup(workspace,campusId,!sourceError) ? 'map'
     : canResumeCampusMapSetup(workspace,campusId,!sourceError) ? 'preview' : null
   : null);
 const [draftOpen,setDraftOpen]=useState(!workspace.scene||workspace.scene.draft!==null),[revision,setRevision]=useState(workspace.scene?.revision??0),[published,setPublished]=useState(workspace.scene?.published_version??null),[spaces,setSpaces]=useState<CampusSceneSpace[]>(workspace.spaces.map(p=>({...p,campus_id:campusId}))),[selected,setSelected]=useState<string|null>(initialFocus.selected),[floor,setFloor]=useState<string|null>(initialFocus.floor),[panel,setPanel]=useState<'map'|'preview'|'assisted'|'publication'|'source'|'items'|'review'|'places'|'floorplan'|null>(initialPanel),[mode,setMode]=useState<'2d'|'2.5d'>(initialFocus.mode),[camera,setCamera]=useState(initialCampusCamera),[asset,setAsset]=useState('0'),[drawing,setDrawing]=useState<CampusScenePoint[]|null>(null),[creating,setCreating]=useState(false),[floorPlan,setFloorPlan]=useState<SceneFloorPlanContext|null>(null),[search,setSearch]=useState(''),[page,setPage]=useState(1),[onlyPending,setOnlyPending]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[preparing,setPreparing]=useState(false),[floorImageId,setFloorImageId]=useState<string|undefined>(),[showGuide,setShowGuide]=useState(true),[reviewChecks,setReviewChecks]=useState({signature:'',values:[false,false,false]});
 const [mapBoundary,setMapBoundary]=useState<CampusAreaPoint[]>([]);
 const [assistance,setAssistance]=useState<CampusMapAssistance|null>(null);
 const [confirmedFacilities,setConfirmedFacilities]=useState<CampusMapReviewHints>({});
 const [mapPlaceKinds,setMapPlaceKinds]=useState<ReadonlyMap<string,ScenePlaceKind>>(()=>new Map());
 const working=useRef(false),imageReceipt=useRef<CampusSceneImage|null>(null),uploadedImage=useRef<CampusSceneImage|null>(null),lookupReceipt=useRef<CampusSceneLocation[]>([]),floorBase=useRef<CampusSceneDocument|null>(null),image=useCampusSceneImage(schoolId,campusId,document.source.image_asset_id),floorImage=useCampusSceneImage(schoolId,campusId,floorImageId),lighting=useNativeSceneLighting(workspace.campus.timezone),setup=useApi<InstitutionSetup>(panel==='places'?`/api/v1/schools/${encodeURIComponent(schoolId)}/institution-setup/`:null),capabilities=useApi<CampusSceneImportCapabilities>(root+'imports/capabilities/');
 const scope=useMemo(()=>({actorId:session.user!.id,schoolId,mode:session.environment.mode,namespaceId:session.environment.namespace_id??null,origin:getApiOrigin()}),[session.user?.id,schoolId,session.environment.mode,session.environment.namespace_id]);
 const accepted=(value:CampusSceneWorkspace,assertCurrent:()=>void,action:NativePendingAction)=>{
  if(value.campus.id!==campusId)throw new Error('The refreshed draft belongs to another campus.');
  knownRevision.current=Math.max(knownRevision.current,value.scene?.revision??0);
  const receipt=action.receipt as Record<string,unknown>|undefined;if(!receipt)throw new Error('The exact layout receipt is unavailable.');assertCurrent();
  if(/\/(draft|publish|reopen|reviewed-places)\/$/.test(action.endpoint)){
   const saved=receipt as unknown as CampusSceneReceipt;if(value.scene?.id!==saved.id||(value.scene?.revision??0)<saved.revision)throw new Error('The current saved layout does not confirm the retained scene receipt.');
   const next=value.scene!.draft??value.scene!.published?.document;if(!nativeSceneDocument(next))throw new Error('The saved campus layout is unavailable.');
   client.setQueryData(['campus',session.scopeKey,root+'workspace/'],value);
   if(action.endpoint.endsWith('/publish/')){
    void client.invalidateQueries({queryKey:['campus',session.scopeKey,root+'published/'],exact:true});
    if(panel==='publication')setPanel(null);
   }
   setDraftOpen(value.scene!.draft!==null);setRevision(value.scene!.revision);setPublished(value.scene!.published_version);setSpaces(value.spaces.map(p=>({...p,campus_id:campusId})));history.acceptSaved(next);setFloorPlan(null);floorBase.current=null;
   const guidedPlaceSave=action.endpoint.endsWith('/reviewed-places/')&&(panel==='assisted'||panel==='preview'||panel==='map');
   if(guidedPlaceSave){setConfirmedFacilities({});setMapPlaceKinds(new Map());setSelected(null);}
   setNotice(value.scene!.revision>saved.revision?'Your action was saved; a newer campus draft or publication is now displayed.':action.endpoint.endsWith('/publish/')?'Campus view published. All apps now read this reviewed version.':guidedPlaceSave?'Facilities saved with your campus layout.':'Campus draft saved.');
   if(action.endpoint.endsWith('/reviewed-places/')){const mappings=Array.isArray(receipt.mappings)?receipt.mappings as Array<{proposal_id:string;space_id:string}>:[],mappedFloor=mappings.find(row=>row.proposal_id==='floor_plan_target')?.space_id;if(mappedFloor&&value.spaces.some(row=>row.id===mappedFloor&&row.kind==='floor'&&row.status!=='inactive')){setFloor(mappedFloor);setSelected(null);setMode('2d');}setPanel(guidedPlaceSave?'preview':null);}
  }else if(action.endpoint.endsWith('/images/')){const result=receipt.image as CampusSceneImage;if(action.payload.kind!=='multipart'||result.id!==action.clientId||result.sha256!==action.payload.file.hash||result.byte_size!==action.payload.file.size)throw new Error('The image receipt does not match the original upload.');imageReceipt.current=result;uploadedImage.current=result;setNotice('Source image saved. Continue with its layout or select the source again if you left this step.');}
  else if(action.endpoint.endsWith('/imports/lookup/'))lookupReceipt.current=receipt.locations as CampusSceneLocation[];
  else if(action.endpoint.endsWith('/imports/')){
   const proposed=receipt.document;if(!nativeSceneDocument(proposed))throw new Error('The source layout could not be verified.');
   const continuation=action.continuation as {kind:'floor_plan';buildingId:string;floorId:string|null;newFloor?:{name:string;code:string};baseDocument:CampusSceneDocument}|undefined;
   if(continuation){if(action.payload.kind==='json'){const payload=JSON.parse(action.payload.body);setFloorImageId(payload.image_asset_id);}const base=continuation.baseDocument,building=base.elements.find(e=>e.kind==='building'&&e.space_id===continuation.buildingId);if(!building)throw new Error('The original mapped building is unavailable.');const merged=mergeFloorPlanProposal(base,proposed,building,continuation.floorId,Crypto.randomUUID);floorBase.current=base;history.change(merged.document);setFloorPlan({buildingId:continuation.buildingId,buildingElementId:building.id,floorId:continuation.floorId,newFloor:continuation.newFloor,elementIds:merged.elementIds,imageBounds:merged.imageBounds});setFloor(continuation.floorId);setMode('2d');setPanel(merged.elementIds.length?'places':null);}
   else{
    const mapResult=campusMapAssistance(receipt.assistance);
    const payload=action.payload.kind==='json' ? JSON.parse(action.payload.body) as {kind?:string;boundary?:CampusAreaPoint[]} : {};
    const fromBoundary=payload.kind==='map_area';
    setMapBoundary(fromBoundary?(payload.boundary??[]):[]);
    setAssistance(mapResult);setMapPlaceKinds(new Map());setConfirmedFacilities({});
    history.change(proposed);setFloor(null);setMode(proposed.elements.length?'2.5d':'2d');setPanel(fromBoundary?'preview':null);
   }
   setSelected(null);setCamera(initialCampusCamera);setNotice('Layout prepared. Review names, positions and campus links before saving or publishing.');
  }
 };
 const write=useNativePendingAction<CampusSceneWorkspace>({scope,domain:'campus',ownerHref:href,refreshPath:root+'workspace/',captureOperation:capture,accepted});
 const sourceState=campusSceneSourceState(revision,knownRevision.current,!!sourceError),locked=write.locked||preparing||!draftOpen||sourceState!=='current',dirty=history.dirty||!!drawing||!!floorPlan,formOpen=creating||panel==='map'||panel==='preview'||panel==='assisted'||panel==='publication'||panel==='places'||panel==='source'||panel==='floorplan',controlsLocked=locked||formOpen;
 useScreenExitGuard({blocked:write.busy||preparing,dirty:dirty&&!write.action,title:'Leave this campus draft?',message:'Unsaved drawing changes will be discarded. Saved drafts and retained commands remain available.'});
 const select=document.elements.find(e=>e.id===selected),items=document.elements.filter(e=>(!onlyPending||e.review_state!=='reviewed')&&`${e.label} ${e.kind}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())),actualPage=Math.min(page,Math.max(1,Math.ceil(items.length/8)));
 const focus=useMemo(()=>scenePlaceFocus(document,selected,floorPlan?'2d':mode,floor),[document,selected,mode,floor,floorPlan]);
 const change=(next:CampusSceneDocument)=>{if(locked)return;history.change(next);setError('');};
 const update=(next:CampusSceneElement)=>change({...document,elements:document.elements.map(e=>e.id===next.id?next:e)});
 const task=async(fn:(check:()=>void)=>Promise<void>)=>{if(working.current||write.locked||sourceState!=='current')return false;working.current=true;setPreparing(true);setError('');try{const check=capture();await fn(check);check();return true;}catch(cause){setError(cause instanceof Error?cause.message:'The layout action could not be completed.');return false;}finally{working.current=false;setPreparing(false);}};
 const reloadSource=async(adopt=false)=>{if(working.current||write.locked)return;working.current=true;setPreparing(true);setError('');try{const check=capture(),value=await reload();check();if(adopt){const next=value.scene?.draft??value.scene?.published?.document??emptyNativeScene(value.campus.name);if(!nativeSceneDocument(next))throw new Error('The current saved draft could not be read. Your local changes were retained.');history.acceptSaved(next);knownRevision.current=value.scene?.revision??0;setRevision(value.scene?.revision??0);setDraftOpen(!value.scene||value.scene.draft!==null);setPublished(value.scene?.published_version??null);setSpaces(value.spaces.map(p=>({...p,campus_id:campusId})));setFloorPlan(null);floorBase.current=null;setAssistance(null);setMapBoundary([]);setConfirmedFacilities({});setMapPlaceKinds(new Map());setFloorImageId(undefined);setDrawing(null);setSelected(null);setFloor(null);setPanel(null);setCreating(false);setCamera(initialCampusCamera);setNotice('Current saved campus draft loaded.');}}catch(cause){setError(cause instanceof Error?cause.message:'The current source could not be checked. Your local changes were retained.');}finally{working.current=false;setPreparing(false);}};
 const loadCurrent=()=>{if(dirty||panel==='source'||panel==='floorplan'){const check=capture();Alert.alert('Discard unsaved layout changes?', 'Load the current saved campus draft. Unsaved drawing, floor-plan and source choices will be discarded.',[{text:'Keep editing',style:'cancel'},{text:'Load saved draft',style:'destructive',onPress:()=>{try{check();void reloadSource(true);}catch{}}}]);}else void reloadSource(true);};
 const input=(suffix:string,body:Record<string,unknown>,extra:Partial<NativePendingInput>={}):NativePendingInput=>({endpoint:root+suffix+'/',method:suffix==='draft'?'PUT':'POST',serverKey:'idempotency_key',body,source:{kind:'campus_scene',sourceId:campusId,revision},...extra});
 const send=async(suffix:string,body:Record<string,unknown>,extra:Partial<NativePendingInput>={})=>{const ok=await write.run(input(suffix,body,extra));if(!ok)throw new Error('The layout action is not yet confirmed. Recover its retained original request before continuing.');};
 const upload=async(file:NativePendingFile,check:()=>void):Promise<CampusSceneImage>=>{check();if(knownRevision.current>revision)throw new Error('The campus draft changed. Your original file is retained; review the current saved draft before importing.');const cached=uploadedImage.current;if(cached&&cached.sha256===file.hash&&cached.byte_size===file.size&&cached.mime_type===file.type)return cached;imageReceipt.current=null;await send('images',{}, {multipart:{fields:{rights_confirmed:true},file}});check();const receipt=imageReceipt.current as CampusSceneImage|null;if(!receipt)throw new Error('The saved image receipt is unavailable.');if(knownRevision.current>revision)throw new Error('The campus draft changed while the source image was saved. Your original file is retained; review the current saved draft before importing.');return receipt;};
 const lookupCampus=async(query:string)=>{
  lookupReceipt.current=[];
  const ok=await task(async()=>send('imports/lookup',{query}));
  if(!ok)throw new Error('Campus search could not be confirmed. Check the layout action and retry.');
  return lookupReceipt.current;
 };
 const openMapSource=()=>{
  if(controlsLocked)return;
  const open=()=>{setSelected(null);setPanel('map');};
  if(!document.elements.length&&document.source.kind==='manual'&&!document.source.image_asset_id){open();return;}
  const check=capture();
  Alert.alert('Start a layout from the map?', 'A generated layout replaces the drawing in your editor. You can undo the replacement before saving.', [
   {text:'Keep editing',style:'cancel'},
   {text:'Open map',onPress:()=>{try{check();open();}catch{}}},
  ]);
 };
 const importMapArea=(boundary:CampusAreaPoint[])=>task(async()=>send('imports',{kind:'map_area',label:workspace.campus.name.slice(0,160),boundary}));
 const continueMapReview=async(hints:CampusMapReviewHints)=>{
  if(locked)throw new Error('Wait until the current campus source is ready.');
  if(!Object.keys(hints).length){setSelected(null);setPanel('preview');return;}
  const ok=await task(async check=>{
   const latest=await reload();check();
   if((latest.scene?.revision??0)!==revision)throw new Error('The saved campus draft changed. Load the current draft before saving facilities.');
   const reviewed=assistedFacilityReview(current.current,hints,latest.spaces.map(place=>place.code));
   if(!reviewed.rows.length)throw new Error('These answers no longer match the current layout.');
   await send('reviewed-places',{...reviewed,expected_revision:revision});
  });
  if(!ok)throw new Error('The facility answers are retained here. Check the message above before continuing.');
 };
 const applyMapHint=(featureId:string,hint:CampusMapReviewHint)=>{
  if(locked)throw new Error('Wait until the current campus source is ready.');
  const result=applyCampusMapHints(current.current,{[featureId]:hint});
  const kind=result.kinds.get(featureId);
  if(!kind)throw new Error('Choose a use that matches this mapped feature.');
  history.change(latest=>applyCampusMapHints(latest,{[featureId]:hint}).document);
  setConfirmedFacilities(previous=>({...previous,[featureId]:hint}));
  setMapPlaceKinds(previous=>new Map(previous).set(featureId,kind));
 };
 const importSource=async(request:NativeCampusSourceRequest)=>{const ok=await task(async check=>{
  if(request.kind==='location')await send('imports',{kind:'location',location:request.location,radius_metres:request.radiusMetres});
  else if(request.kind==='geojson')await send('imports',{kind:'geojson',text:request.text,label:request.label.slice(0,160),attribution:request.attribution,rights_confirmed:true});
  else{const uploaded=await upload(request.file,check);if(request.traceOnly||capabilities.data?.image_analysis.available!==true){const longest=Math.max(uploaded.width,uploaded.height);history.change({...emptyNativeScene(workspace.campus.name),bounds:{width:Math.max(1,Math.round(uploaded.width/longest*1000)),height:Math.max(1,Math.round(uploaded.height/longest*1000)),unit:'relative'},source:{kind:request.sourceKind,label:request.label.slice(0,160),image_asset_id:uploaded.id,notes:'Uploaded source image for manual tracing. No places are inferred.'}});setPanel(null);setAssistance(null);setMapPlaceKinds(new Map());setMode('2d');setNotice('Source ready. Add a feature and trace its outline on the plan.');}else await send('imports',{kind:'image',image_asset_id:uploaded.id,label:request.label.slice(0,160),source_kind:request.sourceKind,instructions:request.instructions});}
 });if(!ok)throw new Error('Source preparation is unconfirmed. Review the retained original action.');};
 const importFloor=async(request:NativeFloorPlanIntakeRequest)=>{const ok=await task(async check=>{
  const base=current.current,building=base.elements.find(e=>e.kind==='building'&&e.space_id===request.buildingId),place=spaces.find(p=>p.id===request.buildingId),floorPlace=spaces.find(p=>p.id===request.floorId);if(!building||!place?.revision||request.floorId&&!floorPlace?.revision)throw new Error('Refresh the exact mapped building and floor before continuing.');
  const uploaded=await upload(request.file,check);setFloorImageId(uploaded.id);const continuation={kind:'floor_plan',buildingId:request.buildingId,floorId:request.floorId,newFloor:request.newFloor,baseDocument:base};
  if(request.traceOnly||capabilities.data?.image_analysis.available!==true){const longest=Math.max(uploaded.width,uploaded.height),proposal={...emptyNativeScene(workspace.campus.name),bounds:{width:Math.max(1,Math.round(uploaded.width/longest*1000)),height:Math.max(1,Math.round(uploaded.height/longest*1000)),unit:'relative' as const}};const merged=mergeFloorPlanProposal(base,proposal,building,request.floorId,Crypto.randomUUID);floorBase.current=base;history.change(merged.document);setFloorPlan({buildingId:request.buildingId,buildingElementId:building.id,floorId:request.floorId,newFloor:request.newFloor,elementIds:[],imageBounds:merged.imageBounds});setPanel(null);setFloor(request.floorId);setMode('2d');setNotice('Floor plan ready for tracing. Review the floor and rooms together when finished.');}
  else await send('imports',{kind:'image',purpose:'floor_plan',source_kind:'site_plan',image_asset_id:uploaded.id,label:request.file.name.slice(0,160),instructions:request.instructions,target:{building_id:place.id,expected_building_revision:place.revision,...(floorPlace?{floor_id:floorPlace.id,expected_floor_revision:floorPlace.revision}:{})}},{continuation});
 });if(!ok)throw new Error('Floor-plan preparation is unconfirmed. Review the retained original action.');};
 const add=()=>{const preset=CAMPUS_SCENE_ASSETS[Number(asset)];if(!preset||locked||document.elements.length>=2000)return;const indoor=!!floorPlan||!!floor||preset.kind==='room';if(preset.kind==='room'&&!floor&&!floorPlan){setError('Choose a mapped floor or prepare a floor plan before drawing rooms.');return;}const {key,kind,label,...style}=preset,id=Crypto.randomUUID(),points=defaultPoints(kind,document.bounds,document.elements.length),element:CampusSceneElement={id,kind,label,asset_key:key,...style,geometry:{type:geometryType(kind),points},space_id:null,floor_id:floorPlan?.floorId??floor,parent_element_id:floorPlan?.buildingElementId??(indoor?select?.id:null),review_state:'needs_review'};history.change({...document,elements:[...document.elements,element]});if(floorPlan)setFloorPlan({...floorPlan,elementIds:[...floorPlan.elementIds,id]});setSelected(id);setPanel(null);};
 const finishDrawing=()=>{if(!select||!drawing)return;const minimum=select.geometry.type==='polygon'?3:select.geometry.type==='polyline'?2:1;if(drawing.length<minimum){setError(`Add at least ${minimum} points to this outline.`);return;}update({...select,geometry:{...select.geometry,points:drawing},review_state:'needs_review'});setDrawing(null);};
 const remove=()=>{if(!select)return;const check=capture();Alert.alert('Remove this illustration?', 'Its canonical campus place and resources stay in the campus directory. Child illustrations remain available for review.',[{text:'Keep',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>{try{check();change({...document,elements:document.elements.filter(e=>e.id!==select.id).map(e=>e.parent_element_id===select.id?{...e,parent_element_id:null,review_state:'needs_review'}:e)});if(floorPlan)setFloorPlan({...floorPlan,elementIds:floorPlan.elementIds.filter(id=>id!==select.id)});setSelected(null);}catch{}}}]);};
 const duplicate=()=>{if(!select||locked||document.elements.length>=2000)return;const next=moveElement({...select,id:Crypto.randomUUID(),source_feature_id:undefined,label:(select.label+' copy').slice(0,160),space_id:null,holding_id:null,navigation:undefined,navigation_connector:undefined},document.bounds.width*.02,document.bounds.height*.02,document.bounds);change({...document,elements:[...document.elements,next]});if(floorPlan)setFloorPlan({...floorPlan,elementIds:[...floorPlan.elementIds,next.id]});setSelected(next.id);};
 const furnish=(template:RoomFurnishingTemplate)=>{if(!select||locked)return;const result=furnishSceneRoom(document,select,template,Crypto.randomUUID);if(document.elements.length+result.elements.length>2000){setError('This furnishing exceeds the layout limit.');return;}change({...document,elements:[...document.elements,...result.elements]});if(floorPlan)setFloorPlan({...floorPlan,elementIds:[...floorPlan.elementIds,...result.elements.map(e=>e.id)]});setNotice(`${result.elements.length} editable furnishings added${result.omitted?`; ${result.omitted} did not fit inside the room`:''}. Link real equipment separately.`);};
 const reviewPlaces=async(body:CampusScenePlaceReview)=>{const ok=await task(async()=>{await send('reviewed-places',body as unknown as Record<string,unknown>);await setup.refetch({throwOnError:true});});if(!ok)throw new Error('Place review is unconfirmed. Recover its exact original request.');};
 const issues=draftIssues(document),signature=JSON.stringify(document),checks=reviewChecks.signature===signature?reviewChecks.values:[false,false,false],readiness=sceneOnboardingReadiness(document,spaces);
 const viewHref=domainHref('/more/virtual-campus',domainParams(href),{edit:undefined,element_id:undefined,panel:undefined});
 const layoutFeedback=<>{write.error||error?<Notice tone="warning" message={error||write.error}/>:null}{notice?<Notice message={notice}/>:null}{write.action?<Section title="Retained layout action"><DomainText>{write.action.phase==='accepted'?'The owning service acknowledged this action. Recovery only reads the saved receipt and current campus.':'The original request, source revision, file and key are retained. Recover that exact request before editing.'}</DomainText><Button title={write.resumeHref?'Open original layout action':write.action.phase==='accepted'?'Read saved layout result':'Recover original layout request'} busy={write.busy} onPress={()=>write.resumeHref?onNavigate(write.resumeHref):void write.recover()}/></Section>:null}</>;
 const guidedCanvas=panel==='preview'||panel==='assisted'||panel==='publication';
 const sceneCanvas=<CampusMapCanvas contextKey={session.scopeKey} draftPreview includeSurroundings={!guidedCanvas}
  viewportInsets={guidedCanvas?{top:32,bottom:32}:undefined} editorInterior={floorPlan??undefined} scene={document} floor={floor} mode={floorPlan?'2d':mode} selected={selected} route={null} unavailable={[]} camera={camera} onCameraChange={setCamera} onSelect={id=>{if(!locked&&!drawing&&(!formOpen||panel==='preview')){setSelected(id);if(panel!=='preview')setPanel(null);}}} lighting={lighting.lighting} sunlight={lighting.sunlight} focus={focus} sourceImageUrl={showGuide&&(floorPlan||mode==='2d')?(floorPlan?floorImage.url:floor?undefined:image.url):undefined} sourceImageBounds={floorPlan?{...floorPlan.imageBounds,rotationDeg:floorPlan.imageRotationDeg}:undefined} drawingPoints={drawing??undefined} onPoint={drawing&&!locked?point=>setDrawing(previous=>[...(previous??[]),clampPoint(point,document.bounds)].slice(0,500)):undefined}/>;
 const layoutCanvas=<View style={{height:Math.max(320,Math.min(680,height*(width>900?.58:.46))),borderRadius:20,overflow:'hidden'}}>{sceneCanvas}</View>;
 const mapFeedback=write.error||error||write.action ? layoutFeedback : undefined;
 const leaveSetup=()=>onNavigate('/more');
 const lockNavigation=write.busy||preparing;
 const traditional={label:'Traditional setup',run:()=>{setSelected(null);setPanel(null);}};
 const otherSource={label:'Use a site plan or map file',run:()=>setPanel('source')};
 if(panel==='map'&&sourceState==='current')return <CampusSetupWorkspace
  campusName={workspace.campus.name} phase="boundary" feedback={mapFeedback} locked={lockNavigation} onClose={leaveSetup}
  options={[otherSource,traditional,...(onChooseCampus?[{label:'Choose a different campus',run:()=>{setPanel(null);onChooseCampus();}}]:[])]}
  map={capabilities.isPending?<Loading label="Opening the map…"/>:capabilities.data?.map_area?.available===true&&!capabilities.error
   ? <CampusAreaMap fullscreen initialBoundary={mapBoundary} simulation={session.environment.mode==='simulation'}
      busy={lockNavigation} disabled={locked} onSearch={capabilities.data.map_search.available?lookupCampus:undefined}
      onAreaSelected={boundary=>void importMapArea(boundary)}/>
   : <View style={{padding:24,gap:12}}><Notice message={capabilities.error?.message??capabilities.data?.map_area?.reason??'Map setup is unavailable. You can start from a site plan.'}/><Button title="Use another source" kind="secondary" onPress={otherSource.run}/>{capabilities.error?<Button title="Retry map" kind="secondary" onPress={()=>void capabilities.refetch()}/>:null}</View>}/>;
 if((panel==='preview'||panel==='assisted'||panel==='publication')&&sourceState==='current'){
  const settingUpFacilities=panel==='assisted',reviewingPublication=panel==='publication';
  const guidanceSource=assistance??{status:session.environment.mode==='simulation'?'simulation' as const:'map_only' as const,messages:[]};
  const hasFacilities=canGuideCampusFacilities(guidanceSource,document,confirmedFacilities);
  const saveDraft={label:'Save layout',run:()=>void task(async()=>send('draft',{document:current.current,expected_revision:revision}))};
  const publishReview={label:'Review and publish',run:()=>{setSelected(null);setPanel('publication');}};
  const adjustBoundary={label:'Adjust boundary',run:()=>{setSelected(null);setPanel('map');}};
  const startFacilities={label:'Set up facilities',run:()=>{setSelected(null);setPanel('assisted');}};
  const approvalChecks=['The outlines, entrances and paths match our campus.','I checked the names and floor counts.','The facilities are connected to the right places.'];
  const needsReview=document.elements.some(element=>element.review_state!=='reviewed');
  const publicationPane=<Section title="Confirm the campus layout">
   {needsReview?<>
    {approvalChecks.map((label,index)=><LabeledSwitch key={label} label={label} value={checks[index]!} disabled={locked}
     onChange={value=>setReviewChecks({signature,values:checks.map((current,i)=>i===index?value:current)})}/>)}
    <Button title="Mark layout reviewed" disabled={locked||!checks.every(Boolean)||document.elements.some(element=>!element.label.trim())}
     onPress={()=>change({...document,elements:document.elements.map(element=>({...element,review_state:'reviewed'}))})}/>
   </>:<>
    {issues.map(issue=><Notice key={issue} tone="warning" message={issue}/>)}
    {dirty?<Button title="Save reviewed layout" disabled={locked} onPress={saveDraft.run}/>:<Button title="Publish campus" disabled={locked||!!issues.length||revision<1} onPress={()=>{
     const check=capture();
     Alert.alert('Publish this campus layout?', 'This reviewed layout will appear in Virtual Campus for members.', [
      {text:'Keep reviewing',style:'cancel'},
      {text:'Publish campus',onPress:()=>{try{check();void task(async()=>send('publish',{expected_revision:revision}));}catch{}}},
     ]);
    }}/>}
   </>}
  </Section>;
  return <CampusSetupWorkspace campusName={workspace.campus.name} phase={settingUpFacilities?'facilities':reviewingPublication?'publication':'layout'}
   locked={lockNavigation} map={sceneCanvas} feedback={mapFeedback??(notice==='Facilities saved with your campus layout.'?<Notice message={notice}/>:undefined)}
   featureCount={document.elements.length} onClose={settingUpFacilities||reviewingPublication?()=>{setSelected(null);setPanel('preview');}:leaveSetup}
   options={settingUpFacilities||reviewingPublication?[]:[adjustBoundary,traditional]}
   primary={hasFacilities?startFacilities:dirty&&document.elements.length?saveDraft:document.elements.length?publishReview:adjustBoundary}
   secondary={hasFacilities?(dirty?saveDraft:publishReview):undefined}
   mapTools={<>
    <CampusControl label="Zoom in" icon={PlusIcon} onPress={()=>setCamera(previous=>({...previous,zoom:Math.min(7,previous.zoom*1.35)}))}/>
    <CampusControl label="Zoom out" icon={MinusIcon} onPress={()=>setCamera(previous=>({...previous,zoom:Math.max(1,previous.zoom/1.35)}))}/>
    <CampusControl label="Fit campus" icon={CrosshairSimpleIcon} onPress={()=>setCamera(initialCampusCamera)}/>
   </>}
   guidance={settingUpFacilities?<CampusMapAreaReview assistance={guidanceSource}
    document={document} disabled={locked} initialHints={confirmedFacilities}
    onFocus={featureId=>{setSelected(featureId);setCamera(initialCampusCamera);}}
    onApply={applyMapHint} onContinue={continueMapReview}/>:reviewingPublication?publicationPane:undefined}/>;
 }
 return <Page key="campus-editor" title="Campus layout" subtitle={`${workspace.campus.name} · ${dirty?'Unsaved changes':revision?'Saved draft':'New draft'}`} maxWidth={1400}>{!mapFirst?<ScreenBack title={guide?"Back to campus setup guide":"Back to virtual campus"} fallbackHref={guide?.href??viewHref}/>:null}{guide?<Notice message="Build your campus one part at a time. Save this draft to continue later; add detail when it helps your campus."/>:null}{!draftOpen?<Section title="Published campus view"><DomainText>Reopen this reviewed version to make a new draft. The published map stays available while you edit.</DomainText>{onViewPublished&&published?<Button title="View published campus" disabled={write.locked||preparing} onPress={onViewPublished}/>:null}<Button title="Reopen as a draft" disabled={write.locked||preparing} busy={write.busy} onPress={()=>void task(async()=>send('reopen',{expected_revision:revision}))}/></Section>:null}
 {sourceState!=='current'?<Section title={sourceState==='changed'?'The saved campus draft changed':'Current source unavailable'}><Notice tone="warning" message={sourceState==='changed'?'Your local drawing is retained. Review the current saved draft before making another layout change.':`Your local drawing is retained. Changes are paused until the saved source can be checked. ${sourceError}`}/><ControlButton title="Check saved source" disabled={write.locked||preparing} onPress={()=>void reloadSource()}/><ControlButton title="Load current saved draft" disabled={write.locked||preparing} onPress={loadCurrent}/></Section>:null}
 {layoutFeedback}
 <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><ControlButton title="Export draft" disabled={write.busy||preparing} onPress={()=>{try{const check=capture();void shareCampusDraft(JSON.stringify(document,null,2),`${document.name.replace(/[^a-zA-Z0-9_-]/g,'-')||'campus'}-draft.json`,check).catch(cause=>setError(cause instanceof Error?cause.message:'Draft export unavailable.'));}catch(cause){setError(cause instanceof Error?cause.message:'Draft export unavailable.');}}}/><ControlButton title="Undo" disabled={controlsLocked||!history.canUndo||!!drawing||!!floorPlan} onPress={()=>history.undo()}/><ControlButton title="Redo" disabled={controlsLocked||!history.canRedo||!!drawing||!!floorPlan} onPress={()=>history.redo()}/><ControlButton title="Save draft" kind="primary" disabled={controlsLocked||!!drawing||!!floorPlan||!history.dirty&&revision>0} busy={write.busy} onPress={()=>void task(async()=>send('draft',{document,expected_revision:revision}))}/><ControlButton title={panel==='review'?'Keep editing':'Review & publish'} disabled={controlsLocked||!!drawing} onPress={()=>{setPanel(panel==='review'?null:'review');setSelected(null);}}/></View>
 {layoutCanvas}
 <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><ControlButton title="Zoom in" onPress={()=>setCamera({...camera,zoom:Math.min(7,camera.zoom*1.35)})}/><ControlButton title="Zoom out" onPress={()=>setCamera({...camera,zoom:Math.max(1,camera.zoom/1.35)})}/><ControlButton title="Fit" onPress={()=>setCamera(initialCampusCamera)}/><SegmentedControl label="Map view" value={floorPlan?'2d':mode} disabled={!!drawing||!!floorPlan||formOpen} options={[{value:'2d',label:'Plan'},{value:'2.5d',label:'2.5D'}]} onChange={value=>setMode(value as typeof mode)}/></View>
 {image.error?<Notice tone="warning" message={image.error}/>:null}{image.url||floorImage.url?<LabeledSwitch label="Show private tracing guide" value={showGuide} onChange={setShowGuide}/>:null}
 {drawing?<Section title="Trace this feature"><DomainText>Tap its corners in order. Drag to pan and pinch to zoom. Finish when its outline matches the plan.</DomainText><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><ControlButton title={`Finish outline · ${drawing.length} points`} kind="primary" disabled={controlsLocked} onPress={finishDrawing}/><ControlButton title="Undo point" disabled={controlsLocked||!drawing.length} onPress={()=>setDrawing(drawing.slice(0,-1))}/><ControlButton title="Cancel tracing" disabled={controlsLocked} onPress={()=>setDrawing(null)}/></View></Section>:null}
 {!drawing?<><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><ControlButton title="Start from a source" disabled={controlsLocked||!!floorPlan} onPress={()=>{setPanel('source');setSelected(null);}}/><ControlButton title="Outline on map" disabled={controlsLocked||!!floorPlan} onPress={openMapSource}/>{(assistance||canResumeCampusMapSetup(workspace,campusId,true))&&!floorPlan?<ControlButton title="Open guided campus setup" disabled={controlsLocked} onPress={()=>setPanel('preview')}/>:null}<ControlButton title="Items" disabled={controlsLocked} onPress={()=>{setPanel('items');setSelected(null);}}/><ControlButton title={floorPlan?'Review floor plan':'Connect places'} disabled={controlsLocked} onPress={()=>{setPanel('places');setSelected(null);}}/><ControlButton title="Add floor plan" disabled={controlsLocked||dirty} onPress={()=>setPanel('floorplan')}/><ControlButton title="Campus setup" disabled={controlsLocked||dirty} onPress={()=>onNavigate(`/more/setup/institution/campus?campus_id=${encodeURIComponent(campusId)}`)}/></View>
 <ChoiceMenu label="Add feature" value={asset} options={CAMPUS_SCENE_ASSETS.map((a,index)=>({value:String(index),label:a.label}))} disabled={controlsLocked} onChange={setAsset}/><ControlButton title="Add selected feature" kind="primary" disabled={controlsLocked} onPress={add}/>
 <ChoiceMenu label="Drawing floor" value={floor??''} options={[{value:'',label:'Outdoors'},...spaces.filter(p=>p.kind==='floor').map(p=>({value:p.id,label:p.name}))]} disabled={controlsLocked||!!floorPlan} onChange={value=>{setFloor(value||null);setSelected(null);setCamera(initialCampusCamera);}}/>
 {select&&!formOpen?<><CampusSceneInspector key={select.id} {...{href,document,spaces,disabled:locked}} selected={select} resourceScope={{schoolId,campusId}} fixedFloorContext={!!floorPlan} onUpdate={update} onDelete={remove} onDuplicate={duplicate} onClose={()=>setSelected(null)} onCreatePlace={()=>setCreating(true)}/><ControlButton title="Draw this feature on plan" disabled={controlsLocked} onPress={()=>{setMode('2d');setDrawing([]);}}/>{select.kind==='room'?<CampusSceneRoomFurnishing existingCount={document.elements.filter(e=>e.parent_element_id===select.id).length} disabled={controlsLocked} relativeScale={document.bounds.unit==='relative'} onApply={furnish}/>:null}</>:null}
 {creating&&select?<NativePlaceCreate href={href} initialCampusId={campusId} kind={select.kind==='building'?'building':undefined} returnTitle="Back to layout item" disabled={locked} onClose={()=>setCreating(false)} onCreated={place=>{setSpaces(previous=>[...previous.filter(p=>p.id!==place.id),place]);update({...select,space_id:place.id,review_state:'needs_review'});setCreating(false);}}/>:null}
 {panel==='source'?<CampusSceneSourceIntake {...{href,capabilities:capabilities.data,hasElements:!!document.elements.length,disabled:locked}} onClose={()=>setPanel(null)} onImport={importSource} onLookup={lookupCampus}/>:null}
 {panel==='floorplan'?<CampusSceneFloorPlanIntake {...{href,document,spaces,capabilities:capabilities.data,disabled:locked}} initialBuildingId={select?.kind==='building'?select.space_id??undefined:undefined} onPrepare={importFloor} onClose={()=>setPanel(null)}/>:null}
 {panel==='places'?setup.isPending&&!setup.data?<Loading/>:!setup.data||setup.data.school.id!==schoolId?<Empty title="Current campus places could not load" message={setup.error?.message} onRetry={()=>void setup.refetch()}/>:<><CampusScenePlaceBatchReview error={setup.error?.message} {...{href,document,revision,campusId,disabled:locked||!!setup.error,busy:write.busy,unknown:write.action?.phase==='unknown',floorPlan:floorPlan??undefined}} spaces={setup.data.spaces} suggestedKinds={floorPlan?undefined:mapPlaceKinds} onFloorPlanAdjusted={(next,context)=>{change(next);setFloorPlan(context);}} onSelectElement={id=>setSelected(id)} onReview={reviewPlaces} onRetry={async()=>{await write.recover();}} onClose={()=>setPanel(null)}/>{setup.error?<ControlButton title="Check current campus places" disabled={preparing||write.busy} onPress={()=>void setup.refetch()}/>:null}</>:null}
 {floorPlan?<ControlButton title="Discard unsaved floor plan" kind="danger" disabled={controlsLocked} onPress={()=>{if(floorBase.current)history.change(floorBase.current);setFloorPlan(null);setFloor(null);setSelected(null);setPanel(null);}}/>:null}
 {panel==='items'?<Section title="Layout items"><SearchField label="Find a feature" placeholder="Name or feature type" value={search} onChangeText={value=>{setSearch(value);setPage(1);}}/><LabeledSwitch label="Only items needing review" value={onlyPending} disabled={controlsLocked} onChange={value=>{setOnlyPending(value);setPage(1);}}/>{items.slice((actualPage-1)*8,actualPage*8).map(e=><Row key={e.id} title={e.label} detail={`${e.kind}${e.space_id?' · Linked place':' · Illustration'}`} status={e.review_state==='reviewed'?'Reviewed':'Needs review'} onPress={()=>{setSelected(e.id);setFloor(e.floor_id);setPanel(null);}}/>)}<DomainPages page={actualPage} hasMore={actualPage*8<items.length} onChange={setPage}/></Section>:null}
 {panel==='review'?<Section title="Review campus before publishing"><Field label="Campus view name" value={document.name} editable={!locked} maxLength={160} onChangeText={name=>change({...document,name})}/><DomainText>{document.elements.length} features · {document.elements.filter(e=>e.space_id).length} linked places · {document.elements.filter(e=>e.review_state==='reviewed').length} reviewed</DomainText>{issues.map(issue=><Notice key={issue} tone="warning" message={issue}/>)}{document.elements.some(e=>e.review_state!=='reviewed')?<>{['Building outlines, entrances and paths match our campus.','I checked names, floor counts and landscape features.','Campus links are correct; decoration stays unlinked.'].map((label,index)=><LabeledSwitch key={label} {...{label}} value={checks[index]!} disabled={controlsLocked} onChange={value=>setReviewChecks({signature,values:checks.map((v,i)=>i===index?value:v)})}/>)}<Button title="Mark layout reviewed" kind="secondary" disabled={controlsLocked||!checks.every(Boolean)||document.elements.some(e=>!e.label.trim())} onPress={()=>change({...document,elements:document.elements.map(e=>({...e,review_state:'reviewed'}))})}/></>:null}<Disclosure title={`Directions and optional links · ${readiness.advisories.length} suggestions`}>{readiness.advisories.slice(0,12).map(issue=><Row key={issue.id} title={issue.title} detail={issue.detail} onPress={issue.elementId?()=>{setSelected(issue.elementId!);setPanel(null);}:undefined}/>)}<DomainText>{readiness.limitations.join(' ')}</DomainText></Disclosure><Button title="Publish campus view" disabled={controlsLocked||dirty||!!issues.length||revision<1} onPress={()=>{const check=capture();Alert.alert('Publish this campus layout?', 'This reviewed version will appear in the campus view on every device.',[{text:'Keep reviewing',style:'cancel'},{text:'Publish',onPress:()=>{try{check();void task(async()=>send('publish',{expected_revision:revision}));}catch{}}}]);}}/>{published?<ControlButton title="Reopen published version as a draft" disabled={controlsLocked||dirty} onPress={()=>void task(async()=>send('reopen',{expected_revision:revision}))}/>:null}</Section>:null}
 </>:null}
 </Page>;
}
