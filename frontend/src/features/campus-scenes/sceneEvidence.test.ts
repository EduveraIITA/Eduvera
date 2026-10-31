import {describe,expect,it} from "vitest";
import {projectSceneEvidence,type SceneCanonicalPlace} from "./sceneEvidence";
import type {CampusSceneDocument,CampusSceneElement} from "./types";
import type {SceneEvidenceRecord} from "./sceneOperations.types";

const spaces:SceneCanonicalPlace[]=[
  {id:"building",name:"Academic building",kind:"building",campus_id:"campus",parent_space_id:null,capacity:200},
  {id:"floor",kind:"floor",campus_id:"campus",parent_space_id:"building"},
  {id:"room",name:"Reading room",kind:"room",campus_id:"campus",parent_space_id:"floor",capacity:20},
  {id:"other-room",name:"Science room",kind:"room",campus_id:"campus",parent_space_id:"floor",capacity:18},
  {id:"foreign",kind:"building",campus_id:"other-campus",parent_space_id:null},
];
const element=(id:string,spaceId:string,kind:CampusSceneElement["kind"]="building",floorId:string|null=null):CampusSceneElement=>({id,label:id,kind,space_id:spaceId,floor_id:floorId,geometry:{type:"polygon",points:[{x:0,y:0},{x:50,y:0},{x:50,y:30},{x:0,y:30}]},review_state:"reviewed"});
const building=element("building-shape","building"),room=element("room-shape","room","room","floor");
const scene:CampusSceneDocument={schema_version:1,name:"Campus",bounds:{width:100,height:100,unit:"metres"},source:{kind:"manual",label:"Reviewed"},elements:[building,room]};
const record=(id:string,spaceId:string|null="room",changes:Partial<SceneEvidenceRecord>={}):SceneEvidenceRecord=>({id,spaceId,dimension:"expected",title:"Scheduled class",sourceLabel:"Timetable",temporal:"current",expectedCount:24,...changes});
const project=(records:SceneEvidenceRecord[],changes:Partial<Parameters<typeof projectSceneEvidence>[0]>={})=>projectSceneEvidence({records,spaces,scene,campusId:"campus",layer:"expected",...changes});

describe("canonical operational scene projection",()=>{
  it("rolls hidden room records up only to their known same-campus building and counts records, not people",()=>{
    const first=record("occurrence-one"),result=project([first,first,record("occurrence-two","other-room")]);
    expect(result.markers).toHaveLength(1);expect(result.markers[0]).toMatchObject({id:"expected:building-shape",elementId:building.id,count:2});
    expect(result.markers[0]!.expectedCount).toBeUndefined();
    expect(result.groups[0]).toMatchObject({aggregated:true,spaceIds:["other-room","room"]});
    expect(result.unlocated).toEqual([]);
  });
  it("uses one stable representative when multiple shapes link the same place",()=>{
    const duplicate={...building,id:"z-duplicate"};
    const result=project([record("building-record","building")],{scene:{...scene,elements:[duplicate,building]}});
    expect(result.markers.map(marker=>marker.elementId)).toEqual([building.id]);
    expect(result.groups[0]!.aggregated).toBe(false);
  });
  it("keeps marker identity across translated floor views and requires exact canonical floor membership",()=>{
    const first=project([record("one")],{floorId:"floor"});
    const translated={...room,geometry:{...room.geometry,points:room.geometry.points.map(point=>({x:point.x+100,y:point.y+200}))}};
    expect(project([record("one")],{scene:{...scene,elements:[translated]},floorId:"floor"}).markers).toEqual(first.markers);
    expect(first.markers[0]!.id).toBe("expected:room-shape");
    expect(project([record("one")],{floorId:"wrong-floor",scene:{...scene,elements:[{...room,floor_id:"wrong-floor"}]}}).markers).toEqual([]);
    expect(project([record("one")],{floorId:"floor",scene:{...scene,elements:[building]}}).unlocated).toHaveLength(1);
  });
  it("never uses a matching name, graphic parent, foreign place or a cyclic hierarchy as a location",()=>{
    const renamed={...building,space_id:null,label:"room",parent_element_id:"room"};
    expect(project([record("one")],{scene:{...scene,elements:[renamed]}}).markers).toEqual([]);
    const cyclic=spaces.map(space=>space.id==="building" ? {...space,parent_space_id:"room"} : space);
    expect(project([record("one")],{spaces:cyclic}).markers).toEqual([]);
    expect(project([record("foreign-event","foreign")]).unlocated).toEqual([]);
    expect(project([record("institution-event",null),record("missing-place","missing")]).unlocated).toHaveLength(2);
  });
  it("keeps truth dimensions separate and displays unknown only when explicitly supplied",()=>{
    const records=[record("expected"),record("observation","room",{dimension:"observed",temporal:"historical"}),record("unknown","room",{dimension:"unknown",temporal:"unknown",expectedCount:undefined})];
    expect(project(records,{layer:"observed"}).markers[0]).toMatchObject({dimension:"observed",count:1});
    expect(project(records,{layer:"observed"}).markers[0]!.summary).toContain("historical");
    expect(project(records,{layer:"unknown"}).markers[0]).toMatchObject({dimension:"unknown",count:1});
    expect(project([],{layer:"unknown"}).markers).toEqual([]);
    expect(project(records,{layer:"none"})).toEqual({markers:[],groups:[],unlocated:[]});
  });
  it("exposes one current planned count and capacity pressure for its exact canonical place",()=>{
    const result=project([record("current"),record("old","room",{temporal:"historical",expectedCount:40})],{floorId:"floor"});
    expect(result.markers[0]).toMatchObject({expectedCount:24,plannedCapacityPressure:{expectedCount:24,capacity:20},count:2});
    expect(result.markers[0]!.summary).toContain("Planned capacity pressure");
    expect(result.markers[0]!.summary).toContain("Planned capacity pressure at Reading room: 24 scheduled participants, recorded capacity 20.");
    expect(project([record("one"),record("two")],{floorId:"floor"}).markers[0]!.expectedCount).toBeUndefined();
    expect(project([record("old","room",{temporal:"historical"})],{floorId:"floor"}).markers[0]!.expectedCount).toBeUndefined();
  });
  it("retains one known room's capacity warning on its outdoor building marker without claiming building capacity",()=>{
    const result=project([record("one")]);
    expect(result.groups[0]).toMatchObject({aggregated:true,spaceIds:["room"]});
    expect(result.markers[0]).toMatchObject({elementId:building.id,expectedCount:24,plannedCapacityPressure:{expectedCount:24,capacity:20}});
    expect(result.markers[0]!.summary).toContain("Planned capacity pressure at Reading room: 24 scheduled participants, recorded capacity 20.");
    expect(result.markers[0]!.summary).not.toContain("recorded capacity 200");
  });
  it("makes no combined capacity claim for different child rooms or concurrent assignments",()=>{
    const bothRooms=project([record("reading","room"),record("science","other-room",{expectedCount:22})]);
    expect(bothRooms.markers[0]).toMatchObject({count:2});
    expect(bothRooms.markers[0]!.expectedCount).toBeUndefined();
    expect(bothRooms.markers[0]!.plannedCapacityPressure).toBeUndefined();
    expect(bothRooms.markers[0]!.summary).not.toContain("capacity pressure");
    const historicChild=project([record("reading","room"),record("old-science","other-room",{temporal:"historical",expectedCount:90})]);
    expect(historicChild.markers[0]!.expectedCount).toBe(24);
    expect(historicChild.markers[0]!.plannedCapacityPressure).toBeUndefined();
    const concurrent=project([record("one","room"),record("two","room")]);
    expect(concurrent.markers[0]!.expectedCount).toBeUndefined();
    expect(concurrent.markers[0]!.plannedCapacityPressure).toBeUndefined();
  });
});
