import { describe, expect, it } from 'vitest';
import { facilitiesAction, facilitiesReport } from '../src/facilities/facilities.contracts.js';
import { createEventSchema, eventSessionSchema } from '../src/campus-events/contracts.js';
const id='00000000-0000-4000-8000-000000000001';
const session={title:'Research workshop',session_type:'activity',venue:'Library',starts_at:'2026-11-01T08:00:00Z',ends_at:'2026-11-01T09:00:00Z',attendance_mode:'none'};
describe('Campus asset status and reviewed event location contracts',()=>{
  it('keeps omitted legacy private report commitments unchanged and requires an exact holding for shared status',()=>{
    const legacy=facilitiesReport.parse({command_id:id,expected_revision:0,problem:'Window needs inspection',location_note:'By the reading room'});
    expect(Object.hasOwn(legacy,'asset_impact')).toBe(false);
    expect(facilitiesReport.safeParse({...legacy,asset_impact:'not_working'}).success).toBe(false);
    expect(facilitiesReport.parse({...legacy,holding_id:id,asset_impact:'degraded'}).asset_impact).toBe('degraded');
  });
  it('keeps legacy reopening unclassified and permits an explicit purpose only on reopening',()=>{
    const reopen={command_id:id,expected_revision:4,action:'reopen',note:'Review the same repair'};
    expect(Object.hasOwn(facilitiesAction.parse(reopen),'reopen_kind')).toBe(false);
    expect(facilitiesAction.parse({...reopen,reopen_kind:'record_amendment'}).reopen_kind).toBe('record_amendment');
    expect(facilitiesAction.safeParse({...reopen,action:'verify',reopen_kind:'further_work'}).success).toBe(false);
  });
  it('does not infer canonical places or event inheritance from an identical legacy venue name',()=>{
    const legacy=eventSessionSchema.parse(session);
    expect(Object.hasOwn(legacy,'space_id')).toBe(false);expect(Object.hasOwn(legacy,'use_event_space')).toBe(false);
    expect(eventSessionSchema.parse({...session,space_id:null,use_event_space:false})).toMatchObject({space_id:null,use_event_space:false});
  });
  it('makes inheritance, unmapped and an exact session override mutually explicit',()=>{
    expect(eventSessionSchema.safeParse({...session,space_id:id,use_event_space:true}).success).toBe(false);
    expect(eventSessionSchema.parse({...session,space_id:null,use_event_space:true})).toMatchObject({space_id:null,use_event_space:true});
    expect(eventSessionSchema.parse({...session,space_id:id,use_event_space:false})).toMatchObject({space_id:id,use_event_space:false});
  });
  it('retains old event commitment shape when no map location was supplied',()=>{
    const event=createEventSchema.parse({school_id:id,idempotency_key:id,event_type:'workshop',title:'Research workshop',venue:'Library',
      starts_at:session.starts_at,ends_at:session.ends_at,audience:{mode:'school'},participation_requirement:'mandatory',requires_rsvp:false,
      requires_guardian_consent:false,payment_required:false,sessions:[session]});
    expect(Object.hasOwn(event,'space_id')).toBe(false);expect(Object.hasOwn(event.sessions[0]!,'use_event_space')).toBe(false);
  });
});
