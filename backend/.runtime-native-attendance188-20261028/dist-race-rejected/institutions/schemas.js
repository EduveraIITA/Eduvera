import { z } from "zod";
export const institutionType = z.enum(["school", "college", "university", "standalone", "other"]);
export const searchSchema = z.object({
    q: z.string().trim().min(2).max(180),
    type: institutionType.optional(),
    state: z.string().trim().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(15),
});
export const manualSchema = z.object({
    name: z.string().trim().min(2).max(180),
    institution_type: institutionType,
    state: z.string().trim().min(1).max(120),
    district: z.string().trim().max(120).default(""),
    city: z.string().trim().max(120).default(""),
    address: z.string().trim().min(1).max(1000),
}).refine((value) => Boolean(value.district || value.city), { message: "District or city is required", path: ["city"] });
export const createSchema = z.object({
    directory_id: z.uuid().optional(),
    manual: manualSchema.optional(),
    acknowledged_duplicate_ids: z.array(z.uuid()).max(50).default([]),
}).refine((value) => Boolean(value.directory_id) !== Boolean(value.manual), { message: "Select a directory entry or enter manual details" });
export const likeLiteral = (value) => value.toLowerCase().replace(/[\\%_]/g, "\\$&");
//# sourceMappingURL=schemas.js.map