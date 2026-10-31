import { z } from 'zod';
import { lendingItemInput } from '../institution-setup/lending-item.contracts.js';
const uuid=z.uuid();
export const resourceLoanCommand=z.object({command_id:uuid,expected_revision:z.number().int().nonnegative()});
export const resourceLoanIssue=resourceLoanCommand.extend({expected_revision:z.literal(0),holding_id:uuid,borrower_person_id:uuid,
 due_at:z.iso.datetime({offset:true}),custody_confirmed:z.literal(true),custody_purpose:z.string().trim().min(5).max(500),
 components:z.array(z.object({label:z.string().trim().min(1).max(160),quantity:z.number().int().min(1).max(100)}).strict()).max(20).default([])}).strict();
export const resourceLoanReturn=resourceLoanCommand.extend({observed_at:z.iso.datetime({offset:true}),reason:z.string().trim().max(1000).default(''),
 correction:z.boolean().default(false),supersedes_receipt_id:uuid.optional(),
 parts:z.array(z.object({part_id:uuid,quantity:z.number().int().min(1).max(100),condition:z.enum(['usable','damaged','held'])}).strict()).max(21)}).strict()
 .refine(value=>new Set(value.parts.map(part=>part.part_id)).size===value.parts.length,'Choose each part once.')
 .refine(value=>!value.supersedes_receipt_id||value.correction,'A superseded return requires an explicit correction.')
 .refine(value=>value.parts.length>0||value.correction&&Boolean(value.supersedes_receipt_id),'An empty replacement requires the exact return receipt being corrected.')
 .refine(value=>!value.correction||value.reason.length>=3,'Give the reason for this return correction.');
export const resourceLoanDue=resourceLoanCommand.extend({due_at:z.iso.datetime({offset:true}),reason:z.string().trim().min(3).max(1000)}).strict();
export const resourceLoanCustody=resourceLoanCommand.extend({custodian_person_id:uuid,reason:z.string().trim().min(3).max(1000)}).strict();
export const resourceLoanCustodianOptions=z.object({search:z.string().trim().max(80).default(''),page:z.coerce.number().int().min(1).max(100000).default(1)}).strict();
export const resourceLoanQuestion=resourceLoanCommand.extend({kind:z.enum(['question','returned_claim']),note:z.string().trim().min(3).max(2000),claimed_return_at:z.iso.datetime({offset:true}).nullable().default(null)}).strict()
 .refine(value=>(value.kind==='returned_claim')===(value.claimed_return_at!==null),'A returned claim needs its reported physical date; an ordinary question does not.');
export const resourceLoanReply=resourceLoanCommand.extend({note:z.string().trim().min(3).max(2000)}).strict();
export const resourceLoanList=z.object({view:z.enum(['loans','items','mine']).default('loans'),state:z.enum(['all','outstanding','overdue','returned','questions']).default('all'),
 search:z.string().trim().max(80).default(''),page:z.coerce.number().int().min(1).max(100000).default(1)}).strict();
export const resourceLoanItem=lendingItemInput;
export const resourceLoanOptions=z.object({search:z.string().trim().max(80).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),holding_id:uuid.optional(),person_id:uuid.optional()}).strict();
export interface ResourceLoanWorkRecord {id:string;loan_id:string;question_id:string;revision:number;title:string;
 state:'review_needed'|'waiting_for_review'|'needs_reassignment'|'route_unavailable';href:string;created_at:string;due_at:null;
 message_id:string|null;reviewer:{user_id:string|null;label:string}}
export const resourceLoanHref=(id:string)=>`/areas/resources?loan_id=${encodeURIComponent(id)}`;
