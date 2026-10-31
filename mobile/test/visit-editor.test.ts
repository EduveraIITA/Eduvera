import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArrangedVisit, VisitOptions } from '../../packages/contracts/src/wire/features/gate/visitApi';
import { visitArrangementInput } from '../../backend/src/gate/visit-arrangements.contracts';
import { visitEditorBody } from '../src/lib/visit-editor';
import { describeGateCommand, nativeGateAcceptedResult, nativeGateConfirmationDisposition, validateNativeGateCommand } from '../src/lib/gate-command';
const school='11111111-1111-4111-8111-111111111111',person='22222222-2222-4222-8222-222222222222',place='33333333-3333-4333-8333-333333333333',key='44444444-4444-4444-8444-444444444444',id='55555555-5555-4555-8555-555555555555';
const options={actor:{person_id:person,label:'Contact',revision:4},people:[{id:person,label:'Contact',revision:4}],places:[{id:place,label:'Office',kind:'office'}]} as VisitOptions;
const input={mode:'guest' as const,guest:'Group organiser',person:null,party:'12',title:'Lab demonstration',startsAt:'2026-10-29T10:00:00Z',endsAt:'2026-10-29T11:00:00Z',place:options.places[0]!,contact:options.people[0]!};
test('visit creation uses explicit guest or exact canonical person revision, destination and contact',()=>{const body=visitEditorBody(undefined,input,options);assert.equal(visitArrangementInput.safeParse({...body,command_id:key}).success,true);assert.equal(body.person_id,null);assert.equal(body.guest_name,'Group organiser');assert.equal(body.party_size,12);assert.throws(()=>visitEditorBody(undefined,{...input,party:'12.5'},options));assert.throws(()=>visitEditorBody(undefined,{...input,contact:{...input.contact,revision:3}},options));assert.throws(()=>visitEditorBody(undefined,{...input,place:{...input.place,id:person}},options));assert.equal(visitEditorBody(undefined,{...input,mode:'person',person:input.contact},options).guest_name,null);});
test('observed party identity is immutable while a reviewed planned count may change',()=>{const current={id,revision:8,person:null,guest_name:'Group organiser',last_movement:{direction:'in'}} as ArrangedVisit;assert.equal(visitEditorBody(current,{...input,party:'15'},options).expected_revision,8);assert.throws(()=>visitEditorBody(current,{...input,guest:'Different party'},options));assert.throws(()=>visitEditorBody(current,{...input,mode:'person',person:input.contact},options));});
test('native gate creation/update journals resolve their actual exact source and owning receipt',()=>{const body=visitEditorBody(undefined,input,options),root=`/api/v1/gate/schools/${school}/visit-arrangements`,created=describeGateCommand({path:root+'/',body:JSON.stringify({...body,command_id:key}),commandId:key,visitId:key,label:'Visit created'},'scope',school,key);assert.ok(created);assert.equal(created.sourceId,key);assert.equal(created.action,'arranged');assert.equal(created.confirmationPath,`${root}/${key}/commands/${key}/`);assert.equal(validateNativeGateCommand(created,'scope',school),true);assert.equal(nativeGateAcceptedResult(created,{visit:{id:key,revision:1}}),true);assert.equal(nativeGateConfirmationDisposition(created,{state:'accepted',result:{visit:{id:key,revision:1}}}),'accepted');assert.equal(nativeGateConfirmationDisposition(created,{state:'not_found'}),'retry-identical');const updated=describeGateCommand({path:`${root}/${id}/update/`,body:JSON.stringify({...body,expected_revision:8,command_id:key}),commandId:key,visitId:id,label:'Visit changed'},'scope',school,key);assert.ok(updated);assert.equal(updated.action,'changed');assert.equal(updated.reviewPath,`${root}/${id}/`);assert.equal(nativeGateAcceptedResult(updated,{visit:{id:key,revision:9}}),false);});

test('whole-campus destinations keep campus identity separate from a physical place and require current eligibility',()=>{
 const campus={id:school,label:'Main campus',kind:'campus'},available={...options,campuses:[campus]};
 const body=visitEditorBody(undefined,{...input,place:campus},available);
 assert.equal(body.place_id,null);assert.equal(body.campus_id,school);
 assert.equal(visitArrangementInput.safeParse({...body,command_id:key}).success,true);
 assert.equal(visitArrangementInput.safeParse({...body,place_id:place,command_id:key}).success,false);
 assert.equal(visitArrangementInput.safeParse({...body,campus_id:null,command_id:key}).success,false);
 assert.throws(()=>visitEditorBody(undefined,{...input,place:campus},options));
 assert.throws(()=>visitEditorBody(undefined,{...input,place:{...campus,kind:'office'}},available));
});
