import {describe,expect,it} from "vitest";
import {placeSceneMarkers,sceneEvidenceAnchor,scenePolygonContains} from "./sceneEvidencePlacement";
import type {CampusSceneElement} from "./types";
import type {SceneEvidenceMarker} from "./sceneOperations.types";

const courtyard:CampusSceneElement={id:"court",kind:"surface",label:"Courtyard",space_id:"place",floor_id:null,review_state:"reviewed",geometry:{type:"polygon",points:[{x:0,y:0},{x:70,y:0},{x:70,y:60},{x:50,y:60},{x:50,y:20},{x:20,y:20},{x:20,y:60},{x:0,y:60}]}};
const marker:SceneEvidenceMarker={id:"expected:court",elementId:"court",dimension:"expected",count:1,label:"Expected · Courtyard",summary:"One scheduled activity",expectedCount:120};
describe("evidence marker placement",()=>{
  it("anchors a concave courtyard inside its actual footprint",()=>{
    const anchor=sceneEvidenceAnchor(courtyard)!;
    expect(scenePolygonContains(anchor,courtyard.geometry.points)).toBe(true);
  });
  it("keeps record pills a constant screen size while their anchors follow camera movement",()=>{
    const first=placeSceneMarkers([marker],[courtyard],"2d",1,{x:20,y:40,scale:2},{width:800,height:600})[0]!;
    const zoomed=placeSceneMarkers([marker],[courtyard],"2d",1,{x:30,y:50,scale:4},{width:800,height:600})[0]!;
    expect(first.width).toBe(zoomed.width);
    expect(zoomed.anchor.x).toBeCloseTo((first.anchor.x-20)*2+30);
    expect(placeSceneMarkers([{...marker,elementId:"unknown"}],[courtyard],"2d",1,{x:0,y:0,scale:1},{width:800,height:600})).toEqual([]);
  });
});
