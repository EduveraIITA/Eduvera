import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { AppState, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { VisitPlace } from '../../../../packages/contracts/src/wire/features/gate/visitApi';
import { sceneElementBuilding, sceneFloorBuilding } from '../../../../packages/contracts/src/campus-scenes/sceneInterior';
import { scenePlaceFocus } from '../../../../packages/contracts/src/campus-scenes/scenePlaceCamera';
import { useSession } from '../../auth/SessionProvider';
import { nativeCampusDisplay, nativeCampusPlaceSelection, type NativeCampusSelection } from '../../lib/native-campus';
import { useNativeSceneLighting } from '../../lib/native-scene-lighting';
import { visitPlaceFootprint, visitPlaceSchedule, visitScheduleHighlights, visitWindowLabel, type VisitTimeWindow } from '../../lib/visit-place-presentation';
import { ChoiceMenu, ControlButton } from '../../ui/DomainControls';
import { Empty, Loading, Notice, Button } from '../../ui/components';
import { MotionModal } from '../../ui/Motion';
import { useTheme } from '../../ui/theme';
import { CampusMapCanvas, initialCampusCamera } from '../campus/CampusMapCanvas';
import { CampusBuildingPanel } from '../campus/CampusBuildingPanel';
import { useVisitCampuses, useVisitSchedule } from './useVisitPlaces';

const empty: NativeCampusSelection={selectedId:null,spaceId:null,buildingId:null,floorId:null};
interface Props { schoolId:string; campusChoices?:VisitPlace[]; destination?:VisitPlace; window?:VisitTimeWindow; disabled?:boolean; onClose():void; onChoose?(place:VisitPlace):void }
/** Published geometry only, using the same renderer, hierarchy and selected-world transport. */
export function CampusPlacePortal(props:Props) {
  const session=useSession(),focused=useIsFocused(),{colors}=useTheme(),[foreground,setForeground]=useState(AppState.currentState==='active');
  useEffect(()=>{const listener=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>listener.remove();},[]);
  const active=focused&&foreground&&session.status==='authenticated'&&session.schoolId===props.schoolId&&!session.environment.unavailable;
  return <MotionModal visible={active} presentationStyle={Platform.OS==='ios'&&Platform.isPad?'formSheet':'pageSheet'} animationType="slide" onRequestClose={()=>{if(!props.disabled)props.onClose();}}><SafeAreaProvider><SafeAreaView style={{flex:1,backgroundColor:colors.canvas}} accessibilityViewIsModal>
    <View style={styles.header}><Text accessibilityRole="header" style={[styles.title,{color:colors.ink}]}>{props.onChoose?'Choose on campus':props.destination?.label??'Destination'}</Text><ControlButton title="Done" disabled={props.disabled} onPress={props.onClose}/></View>
    {active?<PortalContents key={`${session.scopeKey}:${props.destination?.id??'choose'}`} {...props}/>:null}
  </SafeAreaView></SafeAreaProvider></MotionModal>;
}
function PortalContents({schoolId,destination,window,disabled,onChoose,campusChoices=[]}:Props) {
  const session=useSession(),{colors}=useTheme(),[campusId,setCampusId]=useState(''),[selection,setSelection]=useState<NativeCampusSelection>(empty),[camera,setCamera]=useState(initialCampusCamera),details=useRef<ComponentRef<typeof ScrollView>>(null);
  const catalogue=useVisitCampuses(schoolId);
  const data=!catalogue.error?catalogue.data:undefined;
  const target=data?.publications.find(row=>destination?.kind==='campus'?row.campus.id===destination.id:row.places.some(place=>place.id===destination?.id));
  const publication=data?.publications.find(row=>row.campus.id===(campusId||target?.campus.id||data.directory.campuses.find(row=>row.is_primary)?.id||data.directory.campuses[0]?.id));
  const scene=useMemo(()=>publication?.scene?{...publication.scene.document,elements:publication.scene.document.elements.filter(row=>row.review_state==='reviewed')}:undefined,[publication]);
  useEffect(()=>{
    if(!scene||!publication)return;
    const requested=destination?nativeCampusPlaceSelection(scene,publication.places,destination.id):null;
    // A destination preview opens outdoors with its actual containing building highlighted.
    const building=requested?sceneElementBuilding(scene,publication.places,scene.elements.find(row=>row.id===requested.selectedId))??sceneFloorBuilding(scene,publication.places,destination!.id):null;
    setSelection(building?{selectedId:building.id,spaceId:building.space_id??null,buildingId:null,floorId:null}:empty);setCamera(initialCampusCamera);
  },[scene,publication,destination?.id]);
  const lighting=useNativeSceneLighting(publication?.campus.timezone),schedule=useVisitSchedule(schoolId,window);
  const display=useMemo(()=>scene&&publication?nativeCampusDisplay(scene,publication.places,selection):null,[scene,publication,selection]);
  const building=display?.contextBuilding,place=publication?.places.find(row=>row.id===selection.spaceId),focus=useMemo(()=>{
    if(!display?.document)return null;
    const selected=scenePlaceFocus(display.document,selection.selectedId,'2.5d',display.floorId);if(selected)return selected;
    const floor=display.floorId&&scene&&building?scenePlaceFocus(scene,building.id,'2.5d',null):null;
    if(floor)return{...floor,key:`floor:${display.floorId}:${floor.key}`};
    const frames=display.document.elements.filter(row=>row.kind==='building'&&row.space_id).map(row=>scenePlaceFocus(display.document!,row.id,'2.5d',null)?.bounds).filter((row):row is NonNullable<typeof row>=>!!row);
    if(!frames.length)return null;
    const x=Math.min(...frames.map(row=>row.x)),y=Math.min(...frames.map(row=>row.y)),right=Math.max(...frames.map(row=>row.x+row.width)),bottom=Math.max(...frames.map(row=>row.y+row.height));
    const bounds={x,y,width:right-x,height:bottom-y};return{key:`building-overview:${JSON.stringify(bounds)}`,bounds};
  },[display,selection.selectedId,scene,building]);
  useEffect(()=>{const frame=requestAnimationFrame(()=>details.current?.scrollTo({y:0,animated:false}));return()=>cancelAnimationFrame(frame);},[selection.spaceId]);
  const highlights=useMemo(()=>publication?visitScheduleHighlights(publication,schedule.error?undefined:schedule.data?.items,window):[],[publication,schedule.data,schedule.error,window]);
  const campusChoice=campusChoices.find(row=>row.kind==='campus'&&row.id===publication?.campus.id);
  const campusOverview=!building;
  const footprint=place?visitPlaceFootprint(place.id,publication?.places??[]):publication?.places.map(row=>row.id)??[];
  const status=visitPlaceSchedule(footprint,schedule.error?undefined:schedule.data?.items,window,schedule.data?.complete);
  const choose=(spaceId:string)=>{if(!scene||!publication)return;const next=nativeCampusPlaceSelection(scene,publication.places,spaceId);if(next)setSelection(next);};
  const buildings=scene?[...new Map(scene.elements.filter(row=>row.kind==='building'&&row.space_id&&publication?.places.some(place=>place.id===row.space_id)).map(row=>[row.space_id!,{value:row.space_id!,label:publication!.places.find(place=>place.id===row.space_id)?.name??row.label}])).values()]:[];
  const selectElement=(id:string)=>{const element=scene?.elements.find(row=>row.id===id);if(!element)return;if(element.space_id){choose(element.space_id);return;}const owner=scene&&publication?sceneElementBuilding(scene,publication.places,element):null;if(owner?.space_id)choose(owner.space_id);};
  const selectedChoice=place?{id:place.id,label:place.name,kind:place.kind,campus_label:publication?.campus.name}:campusChoice;
  if(catalogue.isPending)return <Loading/>;
  if(!data)return <Empty title="Campus preview unavailable" message={catalogue.error?.message} onRetry={()=>void catalogue.refetch()}/>;
  return <View style={{flex:1,minHeight:0}}>
    {data.directory.campuses.length>1?<View style={styles.selector}><ChoiceMenu label="Campus" value={publication?.campus.id??''} options={data.directory.campuses.map(row=>({value:row.id,label:row.name}))} disabled={disabled} onChange={value=>{setCampusId(value);setSelection(empty);}}/></View>:null}
    {building?<View style={styles.selector}><ControlButton title="Campus overview" disabled={disabled} onPress={()=>{setSelection(empty);setCamera(initialCampusCamera);}}/></View>:null}
    {onChoose&&buildings.length?<View style={styles.selector}><ChoiceMenu label="Building" value={building?.space_id??''} options={buildings} disabled={disabled} onChange={choose}/></View>:null}
    {!scene||!display?.document?<Empty title="No published map for this campus" message="Use the searchable place list. A private draft is never substituted."/>:<>
      <View style={styles.map}><CampusMapCanvas contextKey={session.scopeKey} scene={display.document} floor={display.floorId} mode="2.5d" selected={selection.selectedId} placeHighlights={highlights} route={null} unavailable={[]} onSelect={selectElement} camera={camera} onCameraChange={setCamera} viewportInsets={{top:108,bottom:12}} viewBounds={display.interior?.viewBounds} outline={display.interior?.outline} focus={focus} lighting={lighting.lighting} sunlight={lighting.sunlight}/>
        {place||campusOverview?<View pointerEvents="none" style={[styles.mapLabel,{backgroundColor:colors.surface,borderColor:colors.border}]}><Text style={[styles.placeName,{color:colors.ink}]}>{place?.name??publication?.campus.name}</Text>{window?<Text style={{color:colors[status.tone],fontSize:14,lineHeight:20}}>{schedule.isFetching?'Checking schedule…':status.label}{footprint.length>1?campusOverview?' · across mapped campus places':' · includes mapped rooms':''}</Text>:null}</View>:null}
      </View>
      <ScrollView ref={details} keyboardShouldPersistTaps="handled" style={styles.details} contentContainerStyle={{padding:20,gap:12}}>
        {destination&&!target?<Notice message="This exact destination is not linked to published map geometry. No building is guessed from its name."/>:destination&&building?<Text style={[styles.support,{color:colors.muted}]}>Showing {building.label}{destination.id!==building.space_id?` for ${destination.label}`:''}.</Text>:null}
        {!building?<><Text style={[styles.support,{color:colors.muted}]}>Choose the entire campus, or select a building to explore its floors and rooms.</Text>{onChoose&&!campusChoice?<Notice message="Whole-campus selection requires the updated Visits service. Individual mapped places can still be selected."/>:null}</>:<>
          {onChoose&&building.space_id&&place?.id!==building.space_id?<ControlButton title="Use entire building" disabled={disabled} onPress={()=>{const parent=publication!.places.find(row=>row.id===building.space_id);if(parent)onChoose({id:parent.id,label:parent.name,kind:parent.kind,campus_label:publication!.campus.name});}}/>:null}
          {publication!.places.some(row=>row.parent_space_id===building.space_id)?<CampusBuildingPanel building={building} scene={scene} places={publication!.places} assets={[]} selectedSpaceId={selection.spaceId} selectedElementId={selection.selectedId} onSelectPlace={choose} onSelectElement={selectElement} onNavigate={()=>{}}/>:<Text style={[styles.support,{color:colors.muted}]}>Interior places have not been mapped for this building.</Text>}
        </>}
        {window?<Text style={[styles.support,{color:colors.muted}]}>Yellow highlights scheduled conflicts for this visit window. {visitWindowLabel(window)}. Published timetable only; other bookings and closures are not certified. This does not reserve a place.</Text>:<Text style={[styles.support,{color:colors.muted}]}>Choose the visit's start and end times to check its published schedule.</Text>}
      </ScrollView>
    </>}
      {onChoose&&selectedChoice?<View style={[styles.footer,{borderColor:colors.border}]}><Button title={selectedChoice.kind==='campus'?'Choose entire campus':selectedChoice.id===building?.space_id?'Choose entire building':`Choose ${selectedChoice.label}`} disabled={disabled} onPress={()=>onChoose(selectedChoice)}/></View>:null}
  </View>;
}
const styles=StyleSheet.create({header:{minHeight:64,paddingHorizontal:20,flexDirection:'row',alignItems:'center',gap:12},title:{flex:1,fontSize:20,lineHeight:28,fontWeight:'600'},selector:{paddingHorizontal:20,paddingBottom:8},map:{flex:1,flexBasis:0,minHeight:160},details:{flex:1,flexBasis:0,minHeight:140,maxHeight:360},mapLabel:{position:'absolute',left:12,top:12,maxWidth:'80%',padding:12,gap:4,borderRadius:16,borderWidth:StyleSheet.hairlineWidth},placeName:{fontSize:16,lineHeight:24,fontWeight:'600'},support:{fontSize:14,lineHeight:21},footer:{padding:20,borderTopWidth:StyleSheet.hairlineWidth}});
