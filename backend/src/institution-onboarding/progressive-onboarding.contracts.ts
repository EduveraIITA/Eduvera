import { z } from "zod";
import type { AuthUser } from "../common/request.js";

export const goalKeys = ["attendance", "gate", "timetable", "assignments", "fees", "resources", "facilities", "accommodation", "dining", "examinations", "performance", "staff", "messages"] as const;
export type GoalKey = (typeof goalKeys)[number];
export const goalKey = z.enum(goalKeys);
export const wholeCampusGuidancePath = "/more/setup/whole-campus" as const;
export const wholeCampusStartingGoals = ["gate", "timetable", "facilities"] as const;
export type CampusSetupGuidance = "whole_campus" | null;

export const onboardingTimezone = z.string().trim().max(64).refine((value) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Choose a valid timezone.");
const guidance = z.literal("whole_campus").nullable().optional();
const selectedGoals = z.array(z.union([goalKey, z.literal("whole_campus")])).min(1).max(goalKeys.length + 1)
  .refine((values) => new Set(values).size === values.length, "Choose each starting outcome only once.");

function resolveGoals(goals: Array<GoalKey | "whole_campus">): GoalKey[] {
  return [...new Set(goals.flatMap(goal => goal === "whole_campus" ? [...wholeCampusStartingGoals] : [goal]))];
}
function guidanceChoice(input: { goals?: Array<GoalKey | "whole_campus"> | undefined; guidance?: CampusSetupGuidance | undefined }, context: z.RefinementCtx) {
  if (input.goals?.includes("whole_campus") && input.guidance === null) {
    context.addIssue({ code: "custom", path: ["guidance"], message: "Choose whole-campus guidance or leave it, rather than both." });
  }
}

/** Guidance is a preference, not a capability selection or authority ceremony. */
export const provisionWorkspaceSchema = z.object({ goals: selectedGoals.optional(), timezone: onboardingTimezone.optional(), guidance }).strict()
  .superRefine(guidanceChoice).transform(({ goals, ...input }) => ({ ...input,
    ...(goals ? { goals: resolveGoals(goals) } : {}),
    ...(goals?.includes("whole_campus") ? { guidance: "whole_campus" as const } : {}),
  }));
export const updateStartingGoalsSchema = z.object({ goals: selectedGoals, primary: goalKey.optional(), guidance }).strict()
  .superRefine((input, context) => {
    guidanceChoice(input, context);
    if (input.primary && !resolveGoals(input.goals).includes(input.primary)) {
      context.addIssue({ code: "custom", path: ["primary"], message: "The priority outcome must also be selected." });
    }
  }).transform(input => ({ ...input, goals: resolveGoals(input.goals),
    ...(input.goals.includes("whole_campus") ? { guidance: "whole_campus" as const } : {}),
  }));

export interface WholeCampusGuidanceResume {
  kind: "whole_campus";
  path: typeof wholeCampusGuidancePath;
  actor_user_id: string;
  school_id: string;
  requires_recheck: true;
}

/** The caller supplies a current full-campus administrator check. No stored redirect is trusted. */
export function wholeCampusGuidanceResume(user: AuthUser,
  workspace: { guidance: CampusSetupGuidance; school_id: string; owner_user_id: string | null } | null | undefined,
  eligible: boolean): WholeCampusGuidanceResume | null {
  return eligible && user.is_active && workspace?.guidance === "whole_campus"
    && workspace.owner_user_id === user.id && user.active_school_id === workspace.school_id
    ? { kind: "whole_campus", path: wholeCampusGuidancePath, actor_user_id: user.id, school_id: workspace.school_id, requires_recheck: true }
    : null;
}
