import { describe, expect, it, vi } from 'vitest';
import {
  matchCampusInteriorBuildings, readCampusInteriorBuildings, type CampusInteriorBuilding,
} from '../src/agent/agent-campus-building.js';
import {
  campusInteriorBuildingCampusId, campusWorkflowDirection, campusWorkflowRequest, isCampusFloorPlanWebFollowup, resumeCampusWorkflow,
} from '../src/agent/agent-campus-workflow.js';
import { clientUiContextSchema } from '../src/agent/agent-ui.js';

const main='1a8ed921-e1e1-4953-83f5-3634f7c967cf';
const west='314ffbe2-3626-456b-aa65-eacac1b9f314';
const spaceId='b054b98e-ff33-4787-855c-15ee8ee27564';
const directory={can_edit:true,campuses:[{id:main,name:'Main Campus',code:'MAIN'},{id:west,name:'West Campus',code:'WEST'}]};
const context=clientUiContextSchema.parse({screen:'workspace',tools:['open_virtual_campus','open_campus_interiors'],building_selection:true});
const building:CampusInteriorBuilding={
  campus_id:west,campus_name:'West Campus',element_id:'osm-building_301',space_id:spaceId,
  label:'Computing Center 3',aliases:['Computing Centre 3','COMP-003'],
};

describe('Assistant campus building resolution',()=>{
  it('opens the exact current outline when the user starts a new chat about CC3',()=>{
    const task=campusWorkflowRequest('Lets detail of cc3 building');
    expect(task).toEqual({kind:'interiors',building:'cc3 building'});
    expect(campusWorkflowRequest("Let's detail our CC3")).toEqual({kind:'interiors',building:'CC3'});
    expect(campusWorkflowRequest('Please detail the hiring issue')).toBeUndefined();
    expect(campusWorkflowDirection(task!,context,directory,[building])).toMatchObject({
      calls:[{tool:'open_campus_interiors',arguments:{campus_id:west,building_id:'osm-building_301'}}],
      href:`/more/virtual-campus?campus_id=${west}&edit=1&indoor=1&indoor_building_id=osm-building_301`,
      selectedBuilding:building,
    });
    expect(campusWorkflowDirection(task!,{...context,building_selection:undefined},directory,[building]).calls)
      .toEqual([{tool:'open_campus_interiors',arguments:{campus_id:west,building_name:'Computing Center 3'}}]);
    expect(campusWorkflowDirection(task!,context,{...directory,can_edit:false},[building]).calls).toEqual([]);
  });

  it('uses the correction only during an owned interior workflow and preserves the purpose',()=>{
    const correction='I mean computing center 3';
    expect(campusWorkflowRequest(correction)).toBeUndefined();
    expect(resumeCampusWorkflow(undefined,correction)).toBeUndefined();
    expect(resumeCampusWorkflow({kind:'layout',mode:'setup'},correction)).toBeUndefined();
    const corrected=resumeCampusWorkflow({kind:'interiors',building:'different building',floorPlan:true},correction);
    expect(corrected).toEqual({kind:'interiors',building:'computing center 3',floorPlan:true});
    expect(campusWorkflowDirection(corrected!,context,directory,[building]).answer).toContain('public plan');
    expect(isCampusFloorPlanWebFollowup('Could you look it up online?')).toBe(true);
    expect(isCampusFloorPlanWebFollowup('Search the web for campus events')).toBe(false);
  });

  it('deduplicates outlines of one place and presents only genuine alternatives',()=>{
    const extraOutline={...building,element_id:'same-building-second-outline'};
    const mainBuilding={...building,campus_id:main,campus_name:'Main Campus',element_id:'cc3-another-location'};
    expect(matchCampusInteriorBuildings([building,extraOutline],'CC-3')).toEqual([building]);
    const task={kind:'interiors',building:'CC3'} as const;
    const ambiguous=campusWorkflowDirection(task,context,directory,[building,extraOutline,mainBuilding]);
    expect(ambiguous.calls).toEqual([{tool:'open_virtual_campus',arguments:{}}]);
    expect(ambiguous.selection?.options.map(option=>option.element_id)).toEqual(['cc3-another-location','osm-building_301']);
    const current=clientUiContextSchema.parse({screen:'virtual_campus',tools:['open_campus_interiors'],building_selection:true,campus_id:west});
    expect(campusWorkflowDirection(task,current,directory,[building,mainBuilding]).selectedBuilding).toEqual(building);
    expect(campusWorkflowDirection(task,current,directory,[])).toMatchObject({calls:[],selection:{target:'CC3',options:[]}});
    expect(matchCampusInteriorBuildings([building],'Computing Center 30')).toEqual([]);
    const scoped=campusWorkflowRequest('Lets detail cc3 in West Campus');
    expect(scoped).toEqual({kind:'interiors',building:'cc3',campus:'West Campus'});
    expect(campusInteriorBuildingCampusId(scoped!,directory)).toBe(west);
    expect(campusWorkflowDirection(scoped!,context,directory,[mainBuilding,building]).selectedBuilding).toEqual(building);
    expect(resumeCampusWorkflow(scoped,'I mean Computing Center 3')).toEqual({kind:'interiors',building:'Computing Center 3',campus:'West Campus'});
    expect(campusWorkflowDirection({kind:'interiors'},context,directory).selection).toEqual({options:[]});
  });

  it('reads only the active authorized campus scope and accepts no partial result as exact',async()=>{
    const scope={schoolId:main,userId:spaceId,portal:'principal',studentId:null,permissions:[],timezone:'UTC'} as const;
    const credentials={requestId:'request',actorId:spaceId,executionNamespace:`live:${main}`};
    const row={element_id:building.element_id,space_id:spaceId,label:building.label,name:building.aliases[0],code:building.aliases[1]};
    const dispatch=vi.fn().mockResolvedValue([row]);
    const gateway={dispatch};
    expect(await readCampusInteriorBuildings(gateway,{...scope,permissions:[]},credentials,directory,west)).toEqual([building]);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({name:'campus_interior_buildings'}),{campus_id:west},scope,credentials);
    dispatch.mockClear();
    expect(await readCampusInteriorBuildings(gateway,{...scope,permissions:[]},credentials,{...directory,can_edit:false})).toEqual([]);
    expect(await readCampusInteriorBuildings(gateway,{...scope,permissions:[]},credentials,directory,spaceId)).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
    dispatch.mockResolvedValueOnce([row]).mockRejectedValueOnce(new Error('Access no longer active'));
    await expect(readCampusInteriorBuildings(gateway,{...scope,permissions:[]},credentials,directory)).rejects.toThrow('Access no longer active');
    dispatch.mockResolvedValueOnce([{...row,label:'<A>',name:'A',code:'A'}]);
    const [single]=await readCampusInteriorBuildings(gateway,{...scope,permissions:[]},credentials,directory,west);
    expect(single?.label).toBe('Building A');
    expect(matchCampusInteriorBuildings(single?[single]:[],'A building')).toEqual([single]);
  });
});
