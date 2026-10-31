import {describe,expect,it} from 'vitest';
import {simulationDraftChangeDescription} from '../src/auth/execution-environment.interceptor.js';
describe('accepted scenario change descriptions',()=>{
  it('describes the shared activity planner with an exact server target and source revision',()=>{
    const id='00000000-0000-4000-8000-000000000001';
    expect(simulationDraftChangeDescription('POST',`/api/v1/schools/one/activities/plans/${id}/publish`,{id,title:'Campus safety practice',revision:2}))
      .toEqual({domain:'timetable',summary:'Published activity: Campus safety practice',response_id:id,revision:2});
    expect(simulationDraftChangeDescription('POST','/api/v1/schools/one/activities/plans',{id,title:'Night duty',revision:1}).summary)
      .toBe('Created activity draft: Night duty');
  });
  it('keeps participation decisions distinct from timetable edits and never copies arbitrary response data',()=>{
    expect(simulationDraftChangeDescription('POST','/api/v1/schools/one/activities/registers/one/submit',
      {id:'untrusted',revision:NaN,password:'never-copy',roster:[{name:'never-copy'}]}))
      .toEqual({domain:'attendance',summary:'Updated attendance',response_id:null,revision:null});
    expect(simulationDraftChangeDescription('PUT','/api/v1/schools/one/activities/plans/one',{title:'x'.repeat(500)}).summary.length).toBeLessThan(200);
  });
  it('records a repair change without copying private problem, room or photograph details',()=>{
    const id='00000000-0000-4000-8000-000000000001';
    expect(simulationDraftChangeDescription('POST',`/api/v1/schools/one/facilities/repairs/${id}/actions`,
      {id,revision:4,problem:'private concern',location_note:'private room',photos:[{file_name:'private photo'}]}))
      .toEqual({domain:'facilities',summary:'Updated facilities',response_id:id,revision:4});
  });
  it('describes accommodation without copying resident, location or movement evidence',()=>{
    const id='00000000-0000-4000-8000-000000000001';
    expect(simulationDraftChangeDescription('POST',`/api/v1/schools/one/accommodation/stays/${id}/actions`,
      {id,revision:3,resident_person_id:'private',instructions:'private',actual_move_in_at:'private'}))
      .toEqual({domain:'accommodation',summary:'Updated accommodation',response_id:id,revision:3});
  });
});
