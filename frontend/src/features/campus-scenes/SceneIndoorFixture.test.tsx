import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { SceneAssetDrawing, SceneElementOutline } from './SceneAssetDrawing';
import { SCENE_INDOOR_ASSETS, sceneIndoorDimensions, sceneIndoorFootprint } from './sceneIndoorAssets';
import { scenePlaceFocus } from './scenePlaceCamera';
import { SCENE_PLANE_TRANSFORM } from './sceneGeometry';
import type { CampusSceneDocument, CampusSceneElement } from './types';

afterEach(cleanup);
const base:CampusSceneElement={id:'movable',kind:'fixture',label:'Workstation',asset_key:'desk',space_id:null,floor_id:'floor',parent_element_id:'building',review_state:'reviewed',geometry:{type:'point',points:[{x:20,y:30}]}};
describe('editable detailed indoor assets',()=>{
  it('renders all presets in both perspectives and lighting modes without mutating authored data',()=>{
    const silhouettes=new Set<string>();
    for(const asset of SCENE_INDOOR_ASSETS) for(const mode of ['2d','2.5d'] as const) for(const lighting of ['day','night'] as const){
      const element={...base,asset_key:asset.key,width:asset.width,depth:asset.depth,rotation_deg:90}, original=structuredClone(element);
      const {container,unmount}=render(<svg><SceneAssetDrawing element={element} mode={mode} unit={1} lighting={lighting}/></svg>);
      const drawing=container.querySelector('[data-indoor-fixture]')!;
      expect(drawing).toHaveAttribute('data-indoor-fixture',asset.key);
      expect(drawing.getAttribute('transform')).toBe(mode==='2.5d'?SCENE_PLANE_TRANSFORM:null);
      expect(drawing.firstElementChild).toHaveAttribute('transform','translate(20 30) rotate(90)');
      expect(container.innerHTML).not.toMatch(/NaN|Infinity|undefined/);
      if(mode==='2d'&&lighting==='day') silhouettes.add(drawing.innerHTML);
      expect(element).toEqual(original);unmount();
    }
    expect(silhouettes.size).toBe(SCENE_INDOOR_ASSETS.length);
  });
  it('scales only missing preset dimensions and frames an explicit rotated footprint',()=>{
    expect(sceneIndoorDimensions(base,10)).toEqual({width:16,depth:8,rotation:0});
    const item={...base,width:6,depth:2,rotation_deg:90};
    expect(sceneIndoorDimensions(item,10)).toEqual({width:6,depth:2,rotation:90});
    const footprint=sceneIndoorFootprint(item,10);
    expect(footprint[0]!.x).toBeCloseTo(21);expect(footprint[0]!.y).toBeCloseTo(27);
    const {container}=render(<svg><SceneElementOutline element={item} mode="2d" unit={10} scale={2}/></svg>);
    const outline=container.querySelector('polygon')!;
    expect(outline).toHaveAttribute('points',footprint.map(p=>`${p.x},${p.y}`).join(' '));
    expect(outline).toHaveAttribute('stroke-width','1.25');
    const scene:CampusSceneDocument={schema_version:1,name:'Any campus',source:{kind:'manual',label:'Authored'},bounds:{width:100,height:100,unit:'metres'},elements:[item]};
    const focus=scenePlaceFocus(scene,item.id,'2d','floor')!;
    expect(focus.bounds.width).toBeCloseTo(26);expect(focus.bounds.height).toBeCloseTo(30);
    expect(scenePlaceFocus(scene,item.id,'2d','other-floor')).toBeNull();
  });
});
