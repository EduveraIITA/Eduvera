import { randomUUID } from 'node:crypto';
import { describe,expect,it } from 'vitest';
import { resourceLoanIssue,resourceLoanOptions,resourceLoanQuestion,resourceLoanReturn,resourceLoanItem } from '../src/resource-loans/resource-loans.contracts.js';
import { lendingCopyIds,lendingItemPayloadHash } from '../src/institution-setup/lending-item.contracts.js';
import { createHash } from 'node:crypto';

describe('bounded Resources commands',()=>{
 it('validates exact copy quantities and optional tags without changing old single request hashes',()=>{
  const old={command_id:randomUUID(),name:'Camera',asset_tag:'CAM-1',campus_id:randomUUID()};
  expect(lendingItemPayloadHash(resourceLoanItem.parse({...old,quantity:1}))).toBe(createHash('sha256').update(JSON.stringify(old)).digest('hex'));
  expect(resourceLoanItem.parse({...old,asset_tag:''})).toMatchObject({quantity:1,asset_tag:''});
  for(const quantity of [0,-1,1.5,101])expect(resourceLoanItem.safeParse({...old,quantity}).success).toBe(false);
  expect(resourceLoanItem.safeParse({...old,quantity:10,asset_tag:'a'.repeat(77)}).success).toBe(false);
  expect(resourceLoanItem.safeParse({...old,quantity:10,asset_tag:'a'.repeat(76)}).success).toBe(true);
  const ids=lendingCopyIds(old.command_id,100);expect(ids[0]).toBe(old.command_id);expect(new Set(ids).size).toBe(100);expect(lendingCopyIds(old.command_id,100)).toEqual(ids);
 });
 it('requires an explicit exact custodian declaration without academic configuration',()=>{
  const input={command_id:randomUUID(),expected_revision:0,holding_id:randomUUID(),borrower_person_id:randomUUID(),due_at:'2026-10-26T10:00:00Z',custody_confirmed:true,custody_purpose:'Robotics project'};
  expect(resourceLoanIssue.parse(input).components).toEqual([]);
  expect(resourceLoanIssue.safeParse({...input,custody_confirmed:false}).success).toBe(false);
  expect(resourceLoanIssue.safeParse({...input,components:Array.from({length:21},()=>({label:'Part',quantity:1}))}).success).toBe(false);
 });
 it('allows an empty exact replacement only when withdrawing a specified mistaken receipt',()=>{
  const input={command_id:randomUUID(),expected_revision:2,observed_at:'2026-10-24T10:00:00Z',parts:[]};
  expect(resourceLoanReturn.safeParse(input).success).toBe(false);
  expect(resourceLoanReturn.safeParse({...input,correction:true,reason:'Missed receipt'}).success).toBe(false);
  expect(resourceLoanReturn.parse({...input,correction:true,reason:'Wrong person returned it',supersedes_receipt_id:randomUUID()}).parts).toEqual([]);
  const part={part_id:randomUUID(),quantity:1,condition:'usable'};
  expect(resourceLoanReturn.safeParse({...input,parts:[part,part]}).success).toBe(false);
  expect(resourceLoanReturn.safeParse({...input,parts:[{...part,quantity:0}]}).success).toBe(false);
 });
 it('distinguishes a reported physical return date from a question and recorded time',()=>{
  const input={command_id:randomUUID(),expected_revision:1,note:'I returned the book'};
  expect(resourceLoanQuestion.safeParse({...input,kind:'returned_claim'}).success).toBe(false);
  expect(resourceLoanQuestion.parse({...input,kind:'returned_claim',claimed_return_at:'2026-10-24T10:00:00Z'}).kind).toBe('returned_claim');
  expect(resourceLoanQuestion.safeParse({...input,kind:'question',claimed_return_at:'2026-10-24T10:00:00Z'}).success).toBe(false);
 });
 it('bounds searchable pickers but accepts an exact selected canonical identity independently of its page',()=>{
  expect(resourceLoanOptions.parse({page:'2',search:'camera',holding_id:randomUUID(),person_id:randomUUID()})).toMatchObject({page:2,search:'camera'});
  expect(resourceLoanOptions.safeParse({page:0}).success).toBe(false);
  expect(resourceLoanOptions.safeParse({search:'a'.repeat(81)}).success).toBe(false);
 });
});
