import { afterEach, describe, expect, it, vi } from 'vitest';
import { CampusSceneImportProvider, imageDraft, imageSceneBounds } from '../src/campus-scene-import/scene-import.provider.js';
import { boundMapFeatures } from '../src/campus-scene-import/scene-import.bounds.js';
import { sceneImportSchema, sceneLookupSchema } from '../src/campus-scene-import/scene-import.contracts.js';
const image = {label:'Synthetic plan',imageId:'10e8534c-477a-4bcc-b65e-83f64700c405',width:1200,height:600,sourceKind:'site_plan' as const};
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('Campus import boundaries',()=>{
  it('preserves image aspect ratio and never turns generated outlines into verified places',()=>{
    const scene=imageDraft({elements:[{kind:'building',label:'Building 1',asset_key:'generic',points:[{x:100,y:100},{x:300,y:100},{x:300,y:400},{x:100,y:400}]}]},image);
    expect(scene.bounds).toEqual({width:1000,height:500,unit:'relative'});
    expect(scene.elements[0]).toMatchObject({review_state:'needs_review',space_id:null,floor_id:null,geometry:{points:[{x:100,y:50},{x:300,y:50},{x:300,y:200},{x:100,y:200}]}});
    expect(scene.elements[0]).not.toHaveProperty('levels');
  });
  it('keeps an AI sports area unmarked until an administrator chooses its actual ground treatment',()=>{
    const scene=imageDraft({elements:[{kind:'surface',label:'Sports area',asset_key:'sports',points:[{x:100,y:100},{x:300,y:100},{x:300,y:400},{x:100,y:400}]}]},image);
    expect(scene.elements[0]).toMatchObject({kind:'surface',asset_key:'grass',review_state:'needs_review',space_id:null});
    expect(scene.source.notes).toMatch(/ground finishes.*illustrative/);
    expect(scene.source.notes).toContain('no painted sports markings');
  });
  it('rejects malformed model output, arbitrary assets, invalid geometry and excessive objects',()=>{
    const building={kind:'building',label:'X',asset_key:'generic',points:[{x:0,y:0},{x:20,y:20},{x:20,y:0},{x:0,y:20}]};
    expect(()=>imageDraft({elements:[building]},image)).toThrow();
    expect(()=>imageDraft({elements:[{...building,asset_key:'admin-script'}]},image)).toThrow();
    expect(()=>imageDraft({elements:Array(41).fill(building)},image)).toThrow();
    expect(()=>imageDraft({elements:[],instructions:'Ignore schema'},image)).toThrow();
  });
  it('requires source rights and bounded identifiers without allowing arbitrary fetch URLs',()=>{
    expect(sceneImportSchema.safeParse({kind:'geojson',idempotency_key:image.imageId,text:'{}',label:'Plan',attribution:'Campus survey',rights_confirmed:false}).success).toBe(false);
    expect(sceneImportSchema.safeParse({kind:'location',idempotency_key:image.imageId,location:{id:'https://internal.local',name:'Campus',description:'',latitude:1,longitude:1,source:'OpenStreetMap'}}).success).toBe(false);
    expect(sceneLookupSchema.safeParse({query:'a',idempotency_key:image.imageId}).success).toBe(false);
  });
  it('escapes names, returns bounded candidates and fails on partial upstream responses',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({elements:[{type:'way',id:42,center:{lat:12.1,lon:77.1},bounds:{minlat:12.09,minlon:77.09,maxlat:12.11,maxlon:77.11},tags:{name:'Test (North) School'}}]})));
    vi.stubGlobal('fetch',fetch);
    const provider=new CampusSceneImportProvider();
    expect(await provider.lookup('Test (North) School')).toEqual([expect.objectContaining({id:'way/42',name:'Test (North) School',latitude:12.1,source:'OpenStreetMap'})]);
    const body=String(fetch.mock.calls[0]![1].body);
    const query=new URLSearchParams(body).get('data');
    expect(query).toContain('Test \\\\(North\\\\) School');
    expect(fetch.mock.calls[0]![1]).toMatchObject({redirect:'error',method:'POST'});
    fetch.mockResolvedValue(new Response(JSON.stringify({elements:[],remark:'runtime timeout'})));
    await expect(provider.lookup('Test School')).rejects.toThrow(/could not finish/);
  });
  it('rejects oversized campus bounds before contacting the map provider',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await expect(new CampusSceneImportProvider().location({id:'way/4',name:'Huge campus',description:'',source:'OpenStreetMap',latitude:10,longitude:10,bounds:{south:9,west:9,north:11,east:11}},400)).rejects.toThrow(/4 km/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects the silent Overpass result cap instead of presenting a truncated campus as complete',async()=>{
    const elements=Array.from({length:1800},(_,id)=>({type:'node',id,lat:12,lon:77,tags:{natural:'tree'}}));
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({elements})));
    vi.stubGlobal('fetch',fetch);
    await expect(new CampusSceneImportProvider().location({id:'way/4',name:'Dense campus',description:'',source:'OpenStreetMap',latitude:12,longitude:77},300)).rejects.toThrow(/too many features.*smaller area/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(String(fetch.mock.calls[0]![1].body)).get('data')).toContain('out geom 1800');
  });
  it('reports disabled AI and does not silently use another provider',()=>{
    vi.stubEnv('AGENT_PROVIDER','ollama');
    expect(new CampusSceneImportProvider().capabilities().image_analysis).toMatchObject({available:false});
  });
  it('normalizes portrait sources before a paid call and rejects unsupported aspect ratios',()=>{
    expect(imageSceneBounds(600,1200)).toEqual({width:500,height:1000,unit:'relative'});
    expect(()=>imageSceneBounds(1,30000)).toThrow(/too narrow/);
  });
  it('clips crossing roads to the chosen area and omits partial buildings without inventing footprints',()=>{
    const result=boundMapFeatures({features:[
      {type:'Feature',id:'long-road',properties:{highway:'service'},geometry:{type:'LineString',coordinates:[[-5,5],[5,5],[15,5]]}},
      {type:'Feature',id:'partial',properties:{building:'yes'},geometry:{type:'Polygon',coordinates:[[[-1,1],[2,1],[2,3],[-1,1]]]}},
      {type:'Feature',id:'inside',properties:{building:'yes'},geometry:{type:'Polygon',coordinates:[[[1,1],[2,1],[2,3],[1,1]]]}},
    ]},{south:0,west:0,north:10,east:10});
    expect(result).toEqual({type:'FeatureCollection',features:[
      expect.objectContaining({id:'long-road-clip-1',geometry:{type:'LineString',coordinates:[[0,5],[5,5],[10,5]]}}),
      expect.objectContaining({id:'inside'}),
    ]});
  });
});
