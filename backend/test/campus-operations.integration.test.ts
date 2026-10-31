import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
import { createCampusOperationsFixture } from './campus-operations.test-support.js';
import { resourceLoanRequest } from './resource-loans.test-support.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ max: 4,
  connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/map_unused_test' }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = 'false'; });
afterAll(() => db.destroy());
const command = (revision: number) => ({ command_id: randomUUID(), expected_revision: revision });

describe.skipIf(!enabled)('Published campus assets and native repair owner', () => {
  it('scopes repair work before the map bound and retains current waiting/in-progress/verification state exactly once',async()=>{
    const f=await createCampusOperationsFixture(db);
    const foreign=await createCampusOperationsFixture(db);
    const privateForeign=await foreign.run(()=>foreign.facilities.report(foreign.user,foreign.schoolId,{...command(0),problem:'Foreign private unlocated issue',location_note:'Unlinked foreign building'}));
    await f.run(async()=>{
      const otherCampus=await f.topology.createCampus(f.user,f.schoolId,{name:'Remote research campus',code:'REMOTE',campus_type:'branch'},resourceLoanRequest(f.user));
      const otherPlace=await f.topology.createSpace(f.user,f.schoolId,{campus_id:otherCampus.id,name:'Remote workshop',code:'REMOTE-W',kind:'workshop'},resourceLoanRequest(f.user));
      const otherIds:string[]=[];
      for(let index=0;index<21;index++)otherIds.push((await f.facilities.report(f.user,f.schoolId,{...command(0),problem:`Remote workshop issue ${index+1}`,space_id:otherPlace.id})).id);
      let local=await f.facilities.report(f.user,f.schoolId,{...command(0),problem:'Local library power outlet',space_id:f.placeId});
      const holdingOnly=await f.facilities.report(f.user,f.schoolId,{...command(0),problem:'Exact current item needs inspection',holding_id:f.holdingId});
      const unlocated=await f.facilities.report(f.user,f.schoolId,{...command(0),problem:'Location needs clarification',location_note:'Caller has not confirmed a canonical place'});
      const unscoped=await f.facilities.work(f.user,f.schoolId);expect(unscoped.needs_me).toHaveLength(24);
      expect(JSON.stringify(unscoped)).not.toContain(privateForeign.id);
      const selected=await f.facilities.work(f.user,f.schoolId,{campus_id:f.campusId});
      expect(selected.needs_me.map(item=>item.repair_id).sort()).toEqual([local.id,holdingOnly.id,unlocated.id].sort());
      const read=()=>f.operations.view(f.user,f.schoolId,{campus_id:f.campusId});
      local=await f.facilities.act(f.user,f.schoolId,local.id,{...command(local.revision),action:'accept'});
      local=await f.facilities.act(f.user,f.schoolId,local.id,{...command(local.revision),action:'update',status:'waiting',wait_reason:'parts',note:'Waiting for the replacement outlet.'});
      let map=await read(),rows=map.activities.filter(item=>item.layer==='maintenance');
      expect(rows).toHaveLength(3);expect(rows.some(item=>otherIds.includes(item.source.record_id))).toBe(false);
      expect(rows.filter(item=>item.source.record_id===local.id)).toEqual([expect.objectContaining({state:'waiting',space_id:f.placeId,dimension:'accepted'})]);
      expect(rows.find(item=>item.source.record_id===unlocated.id)).toMatchObject({space_id:null,holding_id:null,state:'reported'});
      local=await f.facilities.act(f.user,f.schoolId,local.id,{...command(local.revision),action:'update',status:'in_progress',note:'Replacement is being installed.'});
      map=await read();expect(map.activities.find(item=>item.source.record_id===local.id)?.state).toBe('in_progress');
      local=await f.facilities.act(f.user,f.schoolId,local.id,{...command(local.revision),action:'complete',note:'Installation complete; check is still needed.'});
      map=await read();rows=map.activities.filter(item=>item.source.record_id===local.id);
      expect(rows).toEqual([expect.objectContaining({state:'awaiting_verification',action_label:'Check repair'})]);
      const personal=await f.personal.mine(f.user,f.schoolId,{campus_id:f.campusId});expect(personal.destinations).toContainEqual(expect.objectContaining({source:expect.objectContaining({record_id:local.id})}));
      expect((await f.facilities.work(f.user,f.schoolId,{campus_id:String(otherCampus.id)})).needs_me.map(item=>item.repair_id)).toContain(otherIds[0]);
    });
  },180_000);
  it('shares only explicit anonymous status, preserves participant privacy and distinct completion/verification, and never releases native availability', async () => {
    const f = await createCampusOperationsFixture(db);
    await f.run(async () => {
      const read = () => f.operations.view(f.borrower, f.schoolId, { campus_id: f.campusId });
      expect((await read()).assets[0]).toMatchObject({ holding_id: f.holdingId, native_state: 'available', reportable: true,
        signal: { state: 'unknown', impact: null, open_reports: 0 }, repairs: [] });
      const input = { ...command(0), problem: 'Private explanation and no photo may cross the campus map.', holding_id: f.holdingId,
        asset_impact: 'not_working', space_id: f.placeId };
      let repair = await f.facilities.report(f.user, f.schoolId, input);
      expect(await f.facilities.report(f.user, f.schoolId, input)).toMatchObject({ id: repair.id, revision: 1 });
      await expect(f.facilities.report(f.user, f.schoolId, { ...input, asset_impact: 'degraded' })).rejects.toThrow('different repair work');
      const map = await read();
      expect(map.assets[0]).toMatchObject({ signal: { state: 'reported_fault', impact: 'not_working', open_reports: 1 }, repairs: [] });
      expect(JSON.stringify(map)).not.toMatch(/Private explanation|Custodian|Sana Borrower|reporter_person_id|handler_person_id|photos/);
      expect(JSON.stringify(map)).not.toContain(repair.id);
      const holding=await db.selectFrom('campus_resource_holdings').selectAll().where('id','=',f.holdingId).executeTakeFirstOrThrow();
      const {campus_id,space_id,resource_type_id,name,quantity,asset_tag,notes}=holding;
      await f.topology.updateAsset(f.user,f.schoolId,f.holdingId,{campus_id,space_id,resource_type_id,name,quantity,asset_tag,notes,state:'unavailable',expected_revision:holding.revision},resourceLoanRequest(f.user));
      await expect(f.facilities.detail(f.borrower, f.schoolId, repair.id)).rejects.toThrow('exact participants');
      const own = await f.operations.view(f.user, f.schoolId, { campus_id: f.campusId });
      expect(own.assets[0]?.repairs[0]).toMatchObject({ id: repair.id, target_path: `/areas/facilities?repair_id=${repair.id}` });
      expect(own.activities).toContainEqual(expect.objectContaining({ layer: 'maintenance', holding_id: f.holdingId, space_id: f.placeId }));
      repair = await f.facilities.act(f.user, f.schoolId, repair.id, { ...command(1), action: 'accept' });
      repair = await f.facilities.act(f.user, f.schoolId, repair.id, { ...command(repair.revision), action: 'complete', note: 'The technician reports replacing the lamp.' });
      expect((await read()).assets[0]?.signal.state).toBe('awaiting_verification');
      repair = await f.facilities.act(f.user, f.schoolId, repair.id, { ...command(repair.revision), action: 'verify', note: 'Checked this lamp after the work.' });
      expect((await read()).assets[0]?.signal).toMatchObject({ state: 'verified_resolution', open_reports: 0 });
      expect(await db.selectFrom('campus_resource_holdings').select('state').where('id', '=', f.holdingId).executeTakeFirstOrThrow()).toEqual({ state: 'unavailable' });
      expect((await read()).assets[0]?.native_state).toBe('unavailable');
      repair = await f.facilities.act(f.user, f.schoolId, repair.id, { ...command(repair.revision), action: 'reopen', reopen_kind:'record_amendment', note: 'Correct the recorded repair explanation.' });
      expect((await read()).assets[0]?.signal).toMatchObject({ state: 'verified_resolution', open_reports: 0 });
      repair=await f.facilities.act(f.user,f.schoolId,repair.id,{...command(repair.revision),action:'accept'});
      repair=await f.facilities.act(f.user,f.schoolId,repair.id,{...command(repair.revision),action:'complete',note:'Record amendment completed.'});
      repair=await f.facilities.act(f.user,f.schoolId,repair.id,{...command(repair.revision),action:'verify'});
      repair=await f.facilities.act(f.user,f.schoolId,repair.id,{...command(repair.revision),action:'reopen',note:'Legacy untyped reopening does not prove another failure.'});
      expect((await read()).assets[0]?.signal).toMatchObject({state:'unknown',impact:null,open_reports:1});
      repair=await f.facilities.act(f.user,f.schoolId,repair.id,{...command(repair.revision),action:'accept'});
      repair=await f.facilities.act(f.user,f.schoolId,repair.id,{...command(repair.revision),action:'complete',note:'Reviewed the earlier untyped record.'});
      repair=await f.facilities.act(f.user,f.schoolId,repair.id,{...command(repair.revision),action:'verify'});
      repair = await f.facilities.act(f.user, f.schoolId, repair.id, { ...command(repair.revision), action: 'reopen', reopen_kind:'further_work', note: 'The same lamp has failed again.' });
      expect((await read()).assets[0]?.signal).toMatchObject({ state: 'reported_fault', impact: 'not_working', open_reports: 1 });
      repair=await f.facilities.act(f.user,f.schoolId,repair.id,{...command(repair.revision),action:'accept'});
      repair=await f.facilities.act(f.user,f.schoolId,repair.id,{...command(repair.revision),action:'complete',note:'Further work remains for verification.'});
      repair=await f.facilities.act(f.user,f.schoolId,repair.id,{...command(repair.revision),action:'reopen',reopen_kind:'record_amendment',note:'Amend the record while further work remains unverified.'});
      expect((await read()).assets[0]?.signal).toMatchObject({state:'reported_fault',impact:'not_working'});
      const second = await f.facilities.report(f.borrower, f.schoolId, { ...command(0), problem: 'Intermittent light after dusk', holding_id: f.holdingId, asset_impact: 'degraded' });
      repair = await f.facilities.act(f.user, f.schoolId, repair.id, { ...command(repair.revision), action: 'accept' });
      repair = await f.facilities.act(f.user, f.schoolId, repair.id, { ...command(repair.revision), action: 'complete', note: 'Replacement driver installed.' });
      await f.facilities.act(f.user, f.schoolId, repair.id, { ...command(repair.revision), action: 'verify' });
      expect((await read()).assets[0]?.signal).toMatchObject({ state: 'reported_fault', impact: 'degraded', open_reports: 1 });
      expect((await read()).assets[0]?.repairs[0]?.id).toBe(second.id);
      const refresh = await db.selectFrom('event_outbox').select(['payload', 'audience_user_ids']).where('school_id', '=', f.schoolId).where('event_type', '=', 'campus_assets.updated').execute();
      expect(refresh.length).toBeGreaterThan(5); expect(refresh[0]?.audience_user_ids).toContain(f.borrower.id);
      expect(JSON.stringify(refresh.map(row => row.payload))).not.toMatch(/Private|problem|repair_id|person_id|photo|not_working|degraded/);
      await expect(db.updateTable('facilities_repairs').set({ asset_impact: 'degraded' }).where('id', '=', repair.id).execute()).rejects.toThrow('next exact operation');
      await expect(f.operations.view(f.borrower, f.schoolId, { campus_id: f.campusId, person_id: f.custodianPersonId })).rejects.toThrow('do not accept');
      await expect(f.operations.view({ ...f.borrower, is_active: false }, f.schoolId, { campus_id: f.campusId })).rejects.toThrow();
    });
  }, 120_000);

  it('keeps private/unmapped reports private and resolves exact prefill beyond option pagination without accepting a wrong campus/place', async () => {
    const f = await createCampusOperationsFixture(db);
    await f.run(async () => {
      const options = await f.facilities.options(f.borrower, f.schoolId, { holding_id: f.holdingId, space_id: f.placeId, search: 'unmatched query', page: '200' });
      expect(options).toMatchObject({ holdings: [], places: [], selected: { holding: { id: f.holdingId, map_status_supported: true }, place: { id: f.placeId, label: 'West library' } } });
      const privateItem = await f.resources.createItem(f.user, f.schoolId, { command_id:randomUUID(), campus_id: f.campusId, name: 'Private workroom equipment' }, resourceLoanRequest(f.user));
      await expect(f.facilities.report(f.borrower, f.schoolId, { ...command(0), holding_id: privateItem.id, asset_impact: 'not_working', problem: 'Broken private device' })).rejects.toThrow('published campus map');
      const repair = await f.facilities.report(f.borrower, f.schoolId, { ...command(0), holding_id: f.holdingId, problem: 'Private service question, no shared status selected.' });
      expect((await f.operations.view(f.user, f.schoolId, { campus_id: f.campusId })).assets[0]?.signal.state).toBe('unknown');
      expect(await db.selectFrom('event_outbox').select('id').where('school_id', '=', f.schoolId).where('event_type', '=', 'campus_assets.updated').execute()).toEqual([]);
      const otherCampus = await f.topology.createCampus(f.user, f.schoolId, { name: 'Other campus', code: 'OTH', campus_type: 'branch' }, resourceLoanRequest(f.user));
      const otherPlace = await f.topology.createSpace(f.user, f.schoolId, { campus_id: otherCampus.id, name: 'Other room', code: 'OTHER', kind: 'other' }, resourceLoanRequest(f.user));
      await expect(f.facilities.options(f.borrower, f.schoolId, { holding_id: f.holdingId, space_id: otherPlace.id })).rejects.toThrow('do not match');
      expect(await f.facilities.mapSignals(f.borrower, f.schoolId, String(otherCampus.id), [f.holdingId])).toEqual([]);
      await expect(db.transaction().execute(tx => tx.insertInto('event_outbox').values({ school_id: f.schoolId, event_type: 'campus_assets.updated',
        aggregate_type: 'campus_asset', aggregate_id: f.holdingId, payload: { holding_id: f.holdingId, campus_id: f.campusId, revision: 1,
          source_command_id: randomUUID(), refresh: ['campus-assets'] }, audience_user_ids: [f.borrower.id], notification_user_ids: [], notification_payload: null, idempotency_key: randomUUID() }).execute())).rejects.toThrow();
      expect((await f.facilities.detail(f.borrower, f.schoolId, repair.id)).asset_impact).toBeNull();
    });
  }, 120_000);
});

describe.skipIf(!enabled)('Canonical event location ownership', () => {
  it('filters each explicit session campus inside the owning event query before its page bound',async()=>{
    const f=await createCampusOperationsFixture(db);
    await f.run(async()=>{
      const otherCampus=await f.topology.createCampus(f.user,f.schoolId,{name:'East campus',code:'EAST',campus_type:'branch'},resourceLoanRequest(f.user));
      const otherPlace=await f.topology.createSpace(f.user,f.schoolId,{campus_id:otherCampus.id,name:'East hall',code:'HALL',kind:'auditorium'},resourceLoanRequest(f.user));
      await expect(f.events.create(resourceLoanRequest(f.user),f.eventInput({space_id:randomUUID()}))).rejects.toThrow('current event and session locations');
      let local=await f.events.create(resourceLoanRequest(f.user),f.eventInput({space_id:otherPlace.id,sessions:[{...f.eventInput().sessions[0],use_event_space:false,space_id:f.placeId}]}));
      local=await f.events.publish(resourceLoanRequest(f.user),local.id,{school_id:f.schoolId,expected_revision:local.revision,idempotency_key:randomUUID()}) as typeof local;
      const starts=new Date(Date.parse(f.startsAt)+3_600_000*3).toISOString(),ends=new Date(Date.parse(starts)+3_600_000).toISOString();
      let remote=await f.events.create(resourceLoanRequest(f.user),f.eventInput({title:'East campus workshop',space_id:otherPlace.id,starts_at:starts,ends_at:ends,
        sessions:[{...f.eventInput().sessions[0],starts_at:starts,ends_at:ends,use_event_space:true}]}));
      remote=await f.events.publish(resourceLoanRequest(f.user),remote.id,{school_id:f.schoolId,expected_revision:remote.revision,idempotency_key:randomUUID()}) as typeof remote;
      expect((await f.events.list(f.user,{school_id:f.schoolId,campus_id:f.campusId,status:'published'})).items.map(event=>event.id)).toEqual([local.id]);
      const west=await f.operations.view(f.user,f.schoolId,{campus_id:f.campusId}),east=await f.operations.view(f.user,f.schoolId,{campus_id:String(otherCampus.id)});
      expect(west.activities.filter(item=>item.layer==='events').map(item=>[item.space_id,item.source.record_id])).toEqual([[f.placeId,local.id]]);
      expect(east.activities.filter(item=>item.layer==='events').map(item=>[item.space_id,item.source.record_id])).toEqual([[otherPlace.id,remote.id]]);
      expect(west.bounds).toMatchObject({events_source_limit:30,events_has_more:false,shown:{events:1}});
    });
  },120_000);
  it('preserves legacy unmapped sessions, explicitly inherits/overrides/clears places, and publishes exact native/Core footprints with immutable source locations', async () => {
    const f = await createCampusOperationsFixture(db);
    await f.run(async () => {
      const sessions = f.eventInput().sessions;
      const input = f.eventInput({ sessions: [sessions[0], { ...sessions[0], title: 'East seminar', use_event_space: false, space_id: f.otherPlaceId },
        { ...sessions[0], title: 'Off campus reading', use_event_space: false, space_id: null },
        { title: 'Legacy venue', session_type: 'activity', venue: 'West library', starts_at: f.startsAt, ends_at: f.endsAt, attendance_mode: 'none', participant_student_ids: [] }]
        .map((session,index)=>({...session,starts_at:new Date(Date.parse(f.startsAt)+index*900_000).toISOString(),ends_at:new Date(Date.parse(f.startsAt)+(index+1)*900_000).toISOString()})) });
      let event = await f.events.create(resourceLoanRequest(f.user), input);
      expect(await f.events.create(resourceLoanRequest(f.user), input)).toMatchObject({ id: event.id, revision: 1 });
      expect(Object.fromEntries(event.sessions.map(session => [session.title,[session.space_id, session.use_event_space]]))).toEqual({'Main programme':[null,true],'East seminar':[f.otherPlaceId,false],'Off campus reading':[null,false],'Legacy venue':[null,false]});
      const savedInput = f.eventDefinition(event, { space_id: f.otherPlaceId });
      event = await f.events.save(resourceLoanRequest(f.user), event.id, savedInput);
      expect(event.space_id).toBe(f.otherPlaceId);
      await expect(f.events.save(resourceLoanRequest(f.user),event.id,{...savedInput,idempotency_key:randomUUID()})).rejects.toThrow('changed');
      event=await f.events.save(resourceLoanRequest(f.user),event.id,f.eventDefinition(event,{space_id:null}));expect(event.space_id).toBeNull();
      event = await f.events.save(resourceLoanRequest(f.user), event.id, f.eventDefinition(event, { space_id: f.placeId }));
      const publish = { school_id: f.schoolId, expected_revision: event.revision, idempotency_key: randomUUID() };
      const published = await f.events.publish(resourceLoanRequest(f.user), event.id, publish) as typeof event;
      expect(published).toMatchObject({ status: 'published', space_id: f.placeId });
      expect(await f.events.publish(resourceLoanRequest(f.user), event.id, publish)).toMatchObject({ status: 'published' });
      const occurrences = (await sql<{title:string;space_id:string|null}>`SELECT title,space_id FROM schedule_activity_occurrences WHERE school_id=${f.schoolId}::uuid AND source='event' ORDER BY title`.execute(db)).rows;
      expect(occurrences).toEqual(expect.arrayContaining([{ title: 'Library research workshop · Main programme', space_id: f.placeId },
        { title: 'Library research workshop · East seminar', space_id: f.otherPlaceId },
        { title: 'Library research workshop · Off campus reading', space_id: null }, { title: 'Library research workshop · Legacy venue', space_id: null }]));
      const map = await f.operations.view(f.user, f.schoolId, { campus_id: f.campusId });
      expect(map.activities.filter(item => item.layer === 'events')).toHaveLength(4);
      expect(map.activities).toContainEqual(expect.objectContaining({ title: 'Main programme', space_id: f.placeId, source: { domain: 'events', record_id: event.id, revision: published.revision, label: 'Published event' } }));
      expect(JSON.stringify(map)).not.toMatch(/rsvp|consent|student_id|participants|payment/);
      expect((await f.operations.view(f.borrower, f.schoolId, { campus_id: f.campusId })).activities.filter(item => item.layer === 'events')).toEqual([]);
      expect((await f.events.catalog(f.user, f.schoolId)).places).toContainEqual(expect.objectContaining({ id: f.placeId, campus_id: f.campusId }));
      await expect(f.events.catalog(f.borrower, f.schoolId)).rejects.toThrow('staff only');
      await expect(db.updateTable('campus_events').set({ space_id: f.otherPlaceId }).where('id', '=', event.id).execute()).rejects.toThrow('retain their accepted');
      await expect(db.updateTable('campus_event_sessions').set({ space_id: f.otherPlaceId, use_event_space: false }).where('id', '=', event.sessions[0]!.id).execute()).rejects.toThrow('retain their accepted');
      const commands = await db.selectFrom('campus_model_commands').select(['state', 'command_type']).where('school_id', '=', f.schoolId).where('source_domain', '=', 'events').execute();
      expect(commands).toContainEqual({ state: 'accepted', command_type: 'events.event.publish' });
    });
  }, 120_000);
});
