import { z } from 'zod';
const identifier = z.string().uuid();
const latitude = z.number().finite().min(-85).max(85);
const longitude = z.number().finite().min(-180).max(180);
export const sceneLocationSchema = z.object({
    id: z.string().regex(/^(node|way|relation)\/[0-9]+$/),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(500), latitude, longitude,
    bounds: z.object({ south: latitude, west: longitude, north: latitude, east: longitude }).strict().optional(),
    source: z.literal('OpenStreetMap'),
}).strict();
export const sceneLookupSchema = z.object({
    idempotency_key: identifier, query: z.string().trim().min(4).max(120),
}).strict();
export const sceneImportSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('image'), idempotency_key: identifier, image_asset_id: identifier,
        label: z.string().trim().min(1).max(160), source_kind: z.enum(['aerial_image', 'site_plan']),
        instructions: z.string().trim().max(1000).default('') }).strict(),
    z.object({ kind: z.literal('location'), idempotency_key: identifier, location: sceneLocationSchema,
        radius_metres: z.number().int().min(100).max(1200).default(400) }).strict(),
    z.object({ kind: z.literal('geojson'), idempotency_key: identifier,
        text: z.string().max(2 * 1024 * 1024), label: z.string().trim().min(1).max(160),
        attribution: z.string().trim().min(1).max(500), rights_confirmed: z.literal(true) }).strict(),
]);
//# sourceMappingURL=scene-import.contracts.js.map