import { z } from 'zod';
const uuid = z.uuid();
export const facilitiesCommand = z.object({ command_id: uuid, expected_revision: z.number().int().nonnegative() });
export const facilitiesExternalGrant = facilitiesCommand.extend({ person_id: uuid, expected_person_revision: z.number().int().positive(),
    starts_at: z.iso.datetime({ offset: true }).optional(), ends_at: z.iso.datetime({ offset: true }), instructions: z.string().trim().min(3).max(2000),
    shared_photo_ids: z.array(uuid).max(20).default([]) }).strict().refine(value => new Set(value.shared_photo_ids).size === value.shared_photo_ids.length, 'Choose each shared photo once.');
export const facilitiesExternalEnd = facilitiesCommand.extend({ note: z.string().trim().min(3).max(2000) }).strict();
export const facilitiesSettings = facilitiesCommand.extend({ handler_person_id: uuid, verifier_mode: z.enum(['reporter', 'handler', 'named']),
    verifier_person_id: uuid.nullable().default(null), emergency_contact: z.string().trim().max(300).default('') }).strict()
    .refine(value => (value.verifier_mode === 'named') === (value.verifier_person_id !== null), 'Choose a verifier only for named verification.');
export const facilitiesReport = facilitiesCommand.extend({ expected_revision: z.literal(0), problem: z.string().trim().min(3).max(2000),
    space_id: uuid.nullable().default(null), holding_id: uuid.nullable().default(null), location_note: z.string().trim().max(300).default(''),
    reporter_person_id: uuid.optional(), urgent: z.boolean().default(false), asset_impact: z.enum(['not_working', 'degraded']).nullable().optional() }).strict()
    .refine(value => Boolean(value.space_id || value.holding_id || value.location_note.length >= 3), 'Choose a place or resource, or describe the location.')
    .refine(value => !value.asset_impact || Boolean(value.holding_id), 'A shared asset status needs one exact mapped item.');
export const facilitiesAction = facilitiesCommand.extend({ action: z.enum(['accept', 'assign', 'update', 'complete', 'verify', 'reopen']), note: z.string().trim().max(2000).default(''),
    reopen_kind: z.enum(['further_work', 'record_amendment']).optional(),
    handler_person_id: uuid.optional(), verifier_person_id: uuid.optional(), coordinator_person_id: uuid.optional(), status: z.enum(['in_progress', 'waiting']).optional(), wait_reason: z.enum(['parts', 'contractor', 'approval', 'access', 'other']).nullable().default(null),
    expected_finish_at: z.iso.datetime({ offset: true }).nullable().optional() }).strict()
    .superRefine((value, context) => {
    if (value.action === 'assign' && [value.handler_person_id, value.verifier_person_id, value.coordinator_person_id].filter(Boolean).length !== 1)
        context.addIssue({ code: 'custom', message: 'Choose exactly one next handler, verifier or coordinator.', path: ['handler_person_id'] });
    if (value.action !== 'assign' && value.handler_person_id)
        context.addIssue({ code: 'custom', message: 'Handler changes need an explicit assignment.', path: ['handler_person_id'] });
    if (value.action !== 'reopen' && value.reopen_kind)
        context.addIssue({ code: 'custom', message: 'Choose a reopening purpose only when reopening a repair.', path: ['reopen_kind'] });
    if (value.action !== 'assign' && value.verifier_person_id)
        context.addIssue({ code: 'custom', message: 'Verifier changes need an explicit assignment.', path: ['verifier_person_id'] });
    if (value.action !== 'assign' && value.coordinator_person_id)
        context.addIssue({ code: 'custom', message: 'Coordinator changes need an explicit assignment.', path: ['coordinator_person_id'] });
    if (value.action === 'update' && !value.status)
        context.addIssue({ code: 'custom', message: 'Choose the current progress.', path: ['status'] });
    if (value.action !== 'update' && value.status)
        context.addIssue({ code: 'custom', message: 'Progress belongs to an update.', path: ['status'] });
    if (value.status === 'waiting' && !value.wait_reason)
        context.addIssue({ code: 'custom', message: 'Choose what is holding up the repair.', path: ['wait_reason'] });
    if (value.wait_reason && value.status !== 'waiting')
        context.addIssue({ code: 'custom', message: 'A waiting reason needs waiting progress.', path: ['wait_reason'] });
    if (['assign', 'update', 'complete', 'reopen'].includes(value.action) && value.note.length < 3)
        context.addIssue({ code: 'custom', message: 'Add a short explanation.', path: ['note'] });
    if (value.action !== 'update' && value.expected_finish_at !== undefined)
        context.addIssue({ code: 'custom', message: 'Change the expected date through a progress update.', path: ['expected_finish_at'] });
});
export const facilitiesList = z.object({ view: z.enum(['mine', 'all']).default('mine'), state: z.enum(['open', 'closed', 'all']).default('open'), search: z.string().trim().max(80).default(''), page: z.coerce.number().int().min(1).max(100000).default(1) }).strict();
export const facilitiesOptions = z.object({ search: z.string().trim().max(80).default(''), page: z.coerce.number().int().min(1).max(100000).default(1), person_id: uuid.optional(), space_id: uuid.optional(), holding_id: uuid.optional(), repair_id: uuid.optional() }).strict();
export const facilitiesHref = (id) => `/areas/facilities?repair_id=${encodeURIComponent(id)}`;
//# sourceMappingURL=facilities.contracts.js.map