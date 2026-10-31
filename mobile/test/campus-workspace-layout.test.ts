import assert from 'node:assert/strict';
import test from 'node:test';
import {campusKeyboardOverlap,campusPanelHeight} from '../src/lib/campus-workspace-layout';
import {fitSceneViewport,sceneViewportInsets} from '../../packages/contracts/src/campus-scenes/sceneGeometry';
test('keyboard padding uses actual host intersection below native header, not keyboard height',()=>{assert.equal(campusKeyboardOverlap({y:180,height:620},480),320);assert.equal(campusKeyboardOverlap({y:180,height:300},480),0);assert.equal(campusKeyboardOverlap({y:100,height:700},null),0);assert.equal(campusKeyboardOverlap({y:200,height:100},100),100);});
test('Android resized host and floating keyboard outside host add no second inset',()=>{assert.equal(campusKeyboardOverlap({y:180,height:280},460),0);assert.equal(campusKeyboardOverlap({y:180,height:280},800),0);for(const height of [0,NaN,-1])assert.equal(campusKeyboardOverlap({y:10,height},400),0);});
test('phone keyboard reserves most available space for a scrollable panel and a bounded map strip',()=>{assert.equal(campusPanelHeight(300,false,true),236);assert.equal(campusPanelHeight(200,false,true),152);assert.equal(campusPanelHeight(0,false,true),0);assert.equal(campusPanelHeight(600,false,false),258);assert.equal(campusPanelHeight(600,true,false),384);assert.equal(campusPanelHeight(120,false,false),120);});
test('phone interior entry leaves the real floor usable below its controls instead of the expanded outdoor sheet',()=>{
 const host=650,width=390,bounds={x:337.76936,y:280.95536,width:133.66528,height:111.97128},outline={width:119.344,height:97.65};
 const before={width,height:host-campusPanelHeight(host,true,false),topInset:120,bottomInset:76};
 const after={...before,height:host-campusPanelHeight(host,false,false,true)},oldFit=fitSceneViewport(before,bounds),fit=fitSceneViewport(after,bounds);
 assert.ok(sceneViewportInsets(before).height<100);assert.ok(sceneViewportInsets(after).height>280);
 assert.ok(outline.width*oldFit.scale<100);assert.ok(outline.width*fit.scale>270);assert.ok(outline.height*fit.scale>220);
 assert.ok(fit.scale>oldFit.scale*3,'a floor no longer stays thumbnail-sized when selected from expanded building details');
});
test('expanded floor details keep a bounded map while short/landscape hosts and keyboard remain finite',()=>{
 for(const host of [0,120,200,300,400,600,650,844,1024,NaN]){
  const available=Number.isFinite(host)?host:0,resting=campusPanelHeight(host,false,false,true),expanded=campusPanelHeight(host,true,false,true);
  assert.ok(resting>=0&&resting<=available);assert.ok(expanded>=resting&&expanded<=available);
  assert.equal(campusPanelHeight(host,false,true,true),campusPanelHeight(host,false,true),'indoor mode does not change keyboard ownership');
  if(available>=600)assert.ok(available-expanded>=360,'reading floor details leaves room for both control rows and the drawing');
 }
 assert.equal(campusPanelHeight(650,false,false,true),170);assert.equal(campusPanelHeight(650,true,false,true),270);
});
test('a resting panel reserves the measured native dock outside its useful details viewport',()=>{
 for(const interior of [false,true])for(const expanded of [false,true])for(const dock of [34,94,110,140]){
  const host=650,withDock=campusPanelHeight(host,expanded,false,interior,dock),usable=campusPanelHeight(host-dock,expanded,false,interior);
  assert.ok(Math.abs(withDock-dock-usable)<1e-6,'dock space does not consume the chosen usable panel height');
  assert.ok(withDock<=host&&withDock>=dock);
  assert.equal(campusPanelHeight(host,expanded,true,interior,dock),campusPanelHeight(host,expanded,true,interior),'keyboard overlap already excludes the dock');
 }
 const dock=110,panel=campusPanelHeight(650,false,false,true,dock);
 assert.ok(panel-dock-56>=44,'the resting floor sheet exposes a complete action below its heading and above the dock');
 assert.ok(650-panel>350,'the drawing retains a bounded map viewport');
 for(const dock of [NaN,-1,Infinity])assert.equal(campusPanelHeight(650,false,false,true,dock),170);
 assert.equal(campusPanelHeight(80,false,false,true,110),80,'a short host never overflows its actual bounds');
});
