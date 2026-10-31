import { z } from "zod";
const id = z.uuid(),
  revision = z.number().int().min(0);
const text = (max: number) => z.string().trim().max(max).default("");
const command = { command_id: id, expected_revision: revision };
export const diningMode = z.enum(["native", "reference"]);
const sourceUrl = z
  .string()
  .url()
  .max(1500)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      ![...url.searchParams.keys()].some((key) =>
        /(?:token|secret|password|credential|signature|authorization|api[_-]?key|access[_-]?key)/iu.test(
          key,
        ),
      )
    );
  }, "Use an HTTPS source link without embedded credentials.")
  .nullable()
  .default(null);
export const diningServiceInput = z
  .object({
    ...command,
    id: id.optional(),
    name: z.string().trim().min(2).max(100),
    coordinator_person_id: id,
    space_id: id.nullable().default(null),
    menu_mode: diningMode.default("native"),
    operations_mode: diningMode.default("native"),
    source_label: text(160),
    source_url: sourceUrl,
    source_reference: text(160),
    source_observed_at: z.iso
      .datetime({ offset: true })
      .nullable()
      .default(null),
    active: z.boolean().default(true),
    reason: text(1000),
  })
  .strict();
export const diningSessionInput = z
  .object({
    ...command,
    expected_revision: z.literal(0),
    service_id: id,
    service_expected_revision: z.number().int().positive(),
    label: z.string().trim().min(2).max(100),
    operator_person_id: id,
    space_id: id.nullable().default(null),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    menu_text: text(4000),
  })
  .strict();
export const diningActionInput = z
  .object({
    ...command,
    action: z.enum([
      "save",
      "publish",
      "publish_changes",
      "open",
      "pause",
      "resume",
      "end",
      "cancel",
      "count",
      "correct_count",
      "reassign",
    ]),
    note: text(2000),
    label: z.string().trim().min(2).max(100).optional(),
    menu_text: z.string().trim().max(4000).optional(),
    starts_at: z.iso.datetime({ offset: true }).optional(),
    ends_at: z.iso.datetime({ offset: true }).optional(),
    space_id: id.nullable().optional(),
    operator_person_id: id.optional(),
    coordinator_person_id: id.optional(),
    count_total: z.number().int().min(0).max(10000000).optional(),
    observed_at: z.iso.datetime({ offset: true }).optional(),
    supersedes_receipt_id: id.optional(),
  })
  .strict();
export const diningIssueInput = z
  .object({
    ...command,
    title: z.string().trim().min(2).max(160),
    note: text(2000),
    handler_person_id: id,
  })
  .strict();
export const diningIssueActionInput = z
  .object({
    ...command,
    action: z.enum(["accept", "resolve", "reopen", "reassign"]),
    note: text(2000),
    handler_person_id: id.optional(),
  })
  .strict();
export const diningListInput = z
  .object({
    view: z.enum(["today", "services"]).default("today"),
    date: z.iso.date().optional(),
    search: text(120),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();
export const diningOptionsInput = z
  .object({
    search: text(120),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    service_id: id.optional(),
    session_id: id.optional(),
    issue_id: id.optional(),
    plan_id: id.optional(),
    person_id: id.optional(),
    space_id: id.optional(),
  })
  .strict();
export const diningHistoryInput = z
  .object({
    history_page: z.coerce.number().int().min(1).max(100000).default(1),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();
export const diningHref = (id: string, issue?: string) =>
  `/areas/dining?session_id=${encodeURIComponent(id)}${issue ? `&issue_id=${encodeURIComponent(issue)}` : ""}`;
export interface DiningWorkRecord {
  id: string;
  source_id: string;
  source_kind: "dining_session" | "dining_issue";
  session_id: string;
  issue_id: string | null;
  revision: number;
  title: string;
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
  action: "publish" | "run" | "resolve" | "recover";
}

const zone = z
  .string()
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Choose an IANA timezone.");
const wallTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const diningPlanDayInput = z
  .object({
    weekday: z.number().int().min(1).max(7),
    menu_text: text(4000),
    starts_at: wallTime,
    ends_at: wallTime,
    end_day_offset: z.union([z.literal(0), z.literal(1)]).default(0),
    space_id: id.nullable().default(null),
    operator_person_id: id,
    start_fold: z.enum(["reject", "earlier", "later"]).default("reject"),
    end_fold: z.enum(["reject", "earlier", "later"]).default("reject"),
  })
  .strict();
export const diningPlanInput = z
  .object({
    ...command,
    id: id.optional(),
    service_id: id,
    service_expected_revision: z.number().int().positive(),
    label: z.string().trim().min(2).max(100),
    timezone: zone,
    starts_on: z.iso.date(),
    ends_on: z.iso.date().nullable().default(null),
    days: z.array(diningPlanDayInput).min(1).max(7),
    note: text(2000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.days.map((d) => d.weekday)).size !== value.days.length)
      ctx.addIssue({
        code: "custom",
        path: ["days"],
        message: "Choose each weekday once.",
      });
    if (value.ends_on && value.ends_on < value.starts_on)
      ctx.addIssue({
        code: "custom",
        path: ["ends_on"],
        message: "The last date must follow the first.",
      });
  });
export const diningPlanActionInput = z
  .object({
    ...command,
    note: text(2000),
    starts_on: z.iso.date().optional(),
    stop_from: z.iso.date().optional(),
    coordinator_person_id: id.optional(),
    expected_parent_revision: revision.optional(),
  })
  .strict();
export const diningRangeInput = z
  .object({
    from: z.iso.date(),
    until: z.iso.date(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();
export const diningPlanListInput = z
  .object({
    service_id: id,
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();
export const diningPlanDateActionInput = z
  .object({
    command_id: id,
    expected_plan_version_id: id,
    expected_plan_revision: z.number().int().positive(),
    expected_session_revision: z.literal(0),
    action: z.enum(["open", "publish_changes", "cancel"]),
    note: text(2000),
    menu_text: z.string().trim().max(4000).optional(),
    starts_at: z.iso.datetime({ offset: true }).optional(),
    ends_at: z.iso.datetime({ offset: true }).optional(),
    space_id: id.nullable().optional(),
  })
  .strict();
export interface DiningAvailabilityWarning {
  plan_id: string;
  plan_version_id: string;
  local_date: string;
  weekday: number;
  reason:
    | "nonexistent_time"
    | "ambiguous_time"
    | "invalid_duration"
    | "cancelled_for_date";
  href: string;
}
export interface DiningAvailabilityItem {
  id: string;
  service_id: string;
  service_name: string;
  source_kind: "session" | "plan_date";
  source_id: string;
  source_revision: number;
  session_id: string | null;
  plan_id: string | null;
  local_date: string;
  label: string;
  menu_text: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  space_id: string | null;
  space_label: string | null;
  state: "planned" | "published" | "open" | "paused" | "ended" | "cancelled";
  changed_for_date: boolean;
  updated_at: string;
  href: string;
  availability_only: true;
  venue_reserved: false;
}
export interface DiningAvailabilityPage {
  items: DiningAvailabilityItem[];
  warnings: DiningAvailabilityWarning[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  from: string;
  until: string;
  timezone: string;
}
export const diningPlanHref = (id: string) =>
  `/areas/dining?plan_id=${encodeURIComponent(id)}`;
export const diningDateHref = (series: string, date: string) =>
  `/areas/dining?series_id=${encodeURIComponent(series)}&date=${encodeURIComponent(date)}`;
