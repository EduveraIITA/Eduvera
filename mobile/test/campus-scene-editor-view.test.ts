import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeEditorVisibleElements } from '../src/lib/campus-scene-editor-view';
import type { CampusSceneDocument, CampusSceneElement } from '../../packages/contracts/src/campus-scenes/types';
const e=(id:string,kind:CampusSceneElement['kind'],floor_id:string|null):CampusSceneElement=>({id,kind,label:id,floor_id,space_id:null,review_state:'needs_review',geometry:{type:'point',points:[{x:1,y:1}]}}),scene:CampusSceneDocument={schema_version:1,name:'Campus',bounds:{width:100,height:100,unit:'relative'},source:{kind:'manual',label:'Owned plan'},elements:[e('building','building',null),e('tree','tree',null),e('new-room','room',null),e('new-chair','fixture',null),e('existing-room','room','floor-a'),e('other-floor','room','floor-b')]};
test('an uncreated floor shows its exact proposed rooms and furniture without outdoor cover',()=>{assert.deepEqual(nativeEditorVisibleElements(scene,null,['new-room','new-chair']).map(e=>e.id),['new-room','new-chair']);});
test('adding to an existing floor keeps its recorded room and only explicit new proposals',()=>{assert.deepEqual(nativeEditorVisibleElements(scene,'floor-a',['new-room','new-chair']).map(e=>e.id),['new-room','new-chair','existing-room']);});
test('ordinary published floor and outdoor filtering remain owned by the shared scene visibility contract',()=>{assert.ok(!nativeEditorVisibleElements(scene,null).some(e=>e.id==='new-room'));assert.deepEqual(nativeEditorVisibleElements(scene,'floor-a').map(e=>e.id),['existing-room']);});
