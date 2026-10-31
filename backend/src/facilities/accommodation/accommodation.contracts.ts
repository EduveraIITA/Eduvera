import { z } from "zod";
const id = z.uuid(),
  revision = z.number().int().min(0),
  text = (max: number) => z.string().trim().max(max).default("");
const command = { command_id: id, expected_revision: revision };
const mode = z.enum(["whole_room", "shared"]);
export const accommodationType = z
  .object({
    ...command,
    id: id.optional(),
    name: z.string().trim().min(2).max(100),
    default_capacity: z.number().int().min(1).max(1000),
    allocation_mode: mode,
    active: z.boolean().default(true),
    reason: text(1000),
  })
  .strict();
export const accommodationRoom = z
  .object({
    ...command,
    id: id.optional(),
    space_id: id,
    room_type_id: id,
    sleeping_capacity: z.number().int().min(1).max(1000),
    allocation_mode: mode,
    active: z.boolean().default(true),
    reason: text(1000),
  })
  .strict();
export const accommodationPlace = z
  .object({
    ...command,
    id: id.optional(),
    room_id: id,
    label: z.string().trim().min(1).max(100),
    holding_id: id.nullable().default(null),
    active: z.boolean().default(true),
    reason: text(1000),
  })
  .strict();
export const accommodationOffer = z
  .object({
    ...command,
    expected_revision: z.literal(0),
    // Omission retains the existing offer command hash for exact legacy retries.
    arrangement_basis: z
      .enum(["coordinator_allocation", "resident_offer"])
      .optional(),
    resident_person_id: id,
    room_id: id,
    place_id: id.nullable().default(null),
    coordinator_person_id: id,
    recorder_person_id: id,
    repair_id: id.nullable().default(null),
    origin_space_id: id.nullable().default(null),
    origin_note: text(300),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    instructions: text(2000),
    access_mode: z.enum([
      "no_tracked_item",
      "existing_access",
      "tracked_required",
    ]),
  })
  .strict();
export const accommodationAction = z
  .object({
    ...command,
    action: z.enum([
      "accept",
      "decline",
      "record_response",
      "move_in",
      "move_out",
      "extend",
      "change_end",
      "accept_extension",
      "decline_extension",
      "cancel",
      "correct_move",
      "reassign",
      "close",
    ]),
    note: text(2000),
    observed_at: z.iso.datetime({ offset: true }).optional(),
    method: z.enum(["in_person", "phone", "written"]).optional(),
    response: z.enum(["accept", "decline"]).optional(),
    response_for: z.enum(["offer", "extension"]).optional(),
    ends_at: z.iso.datetime({ offset: true }).optional(),
    destination_space_id: id.nullable().optional(),
    destination_note: text(300),
    coordinator_person_id: id.optional(),
    recorder_person_id: id.optional(),
    supersedes_receipt_id: id.optional(),
    movement: z.enum(["move_in", "move_out"]).optional(),
    retract: z.boolean().default(false),
  })
  .strict();
export const accommodationLoan = z
  .object({
    ...command,
    loan_id: id,
    return_required: z.boolean(),
    note: text(1000),
  })
  .strict();
export const accommodationList = z
  .object({
    view: z.enum(["stays", "rooms"]).default("stays"),
    state: z.enum(["active", "closed", "all"]).default("active"),
    search: text(120),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();
export const accommodationOptions = z
  .object({
    search: text(120),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    stay_id: id.optional(),
    repair_id: id.optional(),
    person_id: id.optional(),
    room_id: id.optional(),
    room_type_id: id.optional(),
    place_id: id.optional(),
    space_id: id.optional(),
    holding_id: id.optional(),
  })
  .strict();
export const accommodationHref = (id: string) =>
  `/areas/accommodation?stay_id=${encodeURIComponent(id)}`;
export interface AccommodationWorkRecord {
  id: string;
  stay_id: string;
  revision: number;
  title: string;
  detail?: string;
  state:
    | "review_needed"
    | "waiting_for_review"
    | "needs_reassignment"
    | "route_unavailable";
  href: string;
  created_at: string;
  due_at: null;
  message_id: string | null;
  owner: { user_id: string | null; label: string };
  action:
    | "respond"
    | "move_in"
    | "review_end"
    | "coordinate"
    | "return_access"
    | "recover";
}
