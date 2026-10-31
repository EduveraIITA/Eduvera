import { createHash } from 'node:crypto';
import { z } from 'zod';
export const lendingItemInput = z.object({ command_id: z.uuid(), name: z.string().trim().min(2).max(160),
    asset_tag: z.string().trim().max(80).default(''), campus_id: z.uuid(), resource_type_id: z.uuid().optional(),
    quantity: z.number().int().min(1).max(100).default(1) }).strict().refine(input => input.quantity === 1 || input.asset_tag.length <= 76, 'Use at most 76 characters for a tag prefix; copy numbers use four characters.');
/** Preserve the exact pre-quantity single-copy hash and property order. */
export function lendingItemPayloadHash(input) {
    return createHash('sha256').update(JSON.stringify({ command_id: input.command_id, name: input.name, asset_tag: input.asset_tag, campus_id: input.campus_id,
        ...(input.resource_type_id ? { resource_type_id: input.resource_type_id } : {}), ...(input.quantity === 1 ? {} : { quantity: input.quantity }) })).digest('hex');
}
export function lendingCopyIds(commandId, quantity) {
    return Array.from({ length: quantity }, (_, index) => {
        if (index === 0)
            return commandId;
        const hash = createHash('sha256').update(`campus-topology:lending-copy:${commandId}:${index + 1}`).digest();
        hash[6] = (hash[6] & 0x0f) | 0x80;
        hash[8] = (hash[8] & 0x3f) | 0x80;
        const hex = hash.subarray(0, 16).toString('hex');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    });
}
export function lendingCopyTags(input) {
    const prefix = input.asset_tag || `ITEM-${input.command_id}`;
    return Array.from({ length: input.quantity }, (_, index) => input.quantity === 1 ? prefix : `${prefix}-${String(index + 1).padStart(3, '0')}`);
}
//# sourceMappingURL=lending-item.contracts.js.map