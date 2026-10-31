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
export type SceneLocation = z.infer<typeof sceneLocationSchema>;
export const sceneLookupSchema = z.object({
  idempotency_key: identifier, query: z.string().trim().min(4).max(120),
}).strict();
export const floorPlanTargetSchema = z.object({
  building_id: identifier, expected_building_revision: z.number().int().positive(),
  floor_id: identifier.optional(), expected_floor_revision: z.number().int().positive().optional(),
}).strict().superRefine((target, context) => {
  if (Boolean(target.floor_id) !== Boolean(target.expected_floor_revision))
    context.addIssue({ code: 'custom', path: ['floor_id'], message: 'Choose the exact current floor and its revision, or review a new floor.' });
});
export type FloorPlanTarget = z.infer<typeof floorPlanTargetSchema>;
export const sceneImportSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), idempotency_key: identifier, image_asset_id: identifier,
    label: z.string().trim().min(1).max(160), source_kind: z.enum(['aerial_image', 'site_plan']),
    instructions: z.string().trim().max(1000).default(''),
    purpose: z.literal('floor_plan').optional(), target: floorPlanTargetSchema.optional(),
  }).strict().superRefine((image, context) => {
    if (image.purpose === 'floor_plan' && (image.source_kind !== 'site_plan' || !image.target))
      context.addIssue({ code: 'custom', path: ['target'], message: 'Choose a mapped building and a floor-plan image for indoor tracing.' });
    if (image.purpose !== 'floor_plan' && image.target)
      context.addIssue({ code: 'custom', path: ['target'], message: 'A building target belongs only to a floor-plan import.' });
  }),
  z.object({ kind: z.literal('location'), idempotency_key: identifier, location: sceneLocationSchema,
    radius_metres: z.number().int().min(100).max(1200).default(400) }).strict(),
  z.object({ kind: z.literal('geojson'), idempotency_key: identifier,
    text: z.string().max(2 * 1024 * 1024), label: z.string().trim().min(1).max(160),
    attribution: z.string().trim().min(1).max(500), rights_confirmed: z.literal(true) }).strict(),
]);
export type SceneImportInput = z.infer<typeof sceneImportSchema>;
