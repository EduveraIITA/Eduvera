import { z } from "zod";
import type { InstitutionMembershipRole } from "../common/request.js";

export const workspaceScopeKinds = [
  "self",
  "dependent",
  "institution",
  "campus",
  "class",
  "offering",
  "person",
  "event",
  "assessment",
  "trip",
  "space",
  "resource",
  "other",
] as const;

export type WorkspaceScopeKind = typeof workspaceScopeKinds[number];

export interface WorkspaceScope {
  readonly kind: WorkspaceScopeKind;
  readonly id?: string;
  readonly label?: string;
}

export type WorkspaceTone = "neutral" | "info" | "attention" | "critical" | "success";

export interface WorkspaceRecord {
  readonly id: string;
  readonly title: string;
  readonly detail?: string;
  readonly status_label?: string;
  readonly time_label?: string;
  /** Source-owned schedule instants/date, never inferred from display labels. */
  readonly starts_at?: string;
  readonly ends_at?: string;
  readonly local_date?: string;
  readonly href?: string;
  readonly action_label?: string;
  readonly source_label?: string;
  readonly source_at?: string;
  readonly tone?: WorkspaceTone;
}

export interface WorkspaceWorkRecord extends WorkspaceRecord {
  readonly kind: "request" | "task" | "offer";
  readonly urgency: "normal" | "due_soon" | "overdue" | "critical";
  readonly due_label?: string;
  readonly href: string;
  readonly action_label: string;
  readonly direction?: "needs_me" | "waiting";
  readonly state?: "action_required" | "waiting_for_review" | "needs_reassignment" | "route_unavailable" | "review_window_ended" | "access_ended";
  readonly owner?: { readonly user_id: string | null; readonly label: string };
  readonly source?: { readonly domain: string; readonly kind: string; readonly id: string; readonly action: string; readonly revision: number | null };
  readonly core_trace?: { readonly message_ids: readonly string[] };
  readonly due_at?: string | null;
  readonly created_at?: string | null;
  readonly occurs_at?: string | null;
}

export interface WorkspaceArea {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly href: string;
  readonly icon: string;
  readonly attention_count: number;
  readonly capabilities: readonly string[];
  readonly scopes: readonly WorkspaceScope[];
  readonly surfaces: readonly WorkspaceAreaSurface[];
}

export interface WorkspaceAreaSurface {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly href: string;
  readonly capabilities: readonly string[];
  readonly scopes: readonly WorkspaceScope[];
}

export interface WorkspaceSetupLink {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly href: string;
  readonly icon?: string;
  /** Exact server-contributed actions represented by this More destination. */
  readonly capabilities?: readonly string[];
  /** Exact institution or learner contexts represented by this contribution. */
  readonly scopes?: readonly WorkspaceScope[];
}

export interface WorkspaceMoreGroup {
  readonly key: "account" | "connections" | "work" | "campus" | "participation" | "oversight" | "setup";
  readonly label: string;
  readonly items: readonly WorkspaceSetupLink[];
}

export const effectiveScheduleSchema = z.object({
  time_zone: z.string().trim().min(1).max(100),
  weekly_windows: z.array(z.object({
    days: z.array(z.number().int().min(1).max(7)).min(1),
    starts_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    ends_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }).strict()).min(1),
}).strict().superRefine((value, context) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.time_zone }).format();
  } catch {
    context.addIssue({ code: "custom", path: ["time_zone"], message: "Use a valid IANA timezone." });
  }
  value.weekly_windows.forEach((window, index) => {
    if (window.ends_at <= window.starts_at) {
      context.addIssue({
        code: "custom",
        path: ["weekly_windows", index, "ends_at"],
        message: "A duty window must end after it starts.",
      });
    }
  });
});

export type EffectiveSchedule = z.infer<typeof effectiveScheduleSchema>;

export interface ResponsibilityAssignmentProjection {
  readonly id: string;
  readonly owner_agent_id: string;
  readonly capability_key: string;
  readonly action_key: string;
  readonly scope: WorkspaceScope;
  readonly effective_from: string;
  readonly effective_until: string | null;
  readonly effective_schedule: unknown;
  readonly authority_source_kind: string;
  readonly authority_source_ref: string;
  readonly fallback_agent_id: string | null;
  readonly source_domain: string;
  readonly source_record_id: string;
  readonly source_revision: number;
  readonly revision: number;
  readonly projection_source: "canonical";
}

export interface OwnedMessageProjection {
  readonly id: string;
  readonly message_kind: "request" | "task" | "offer";
  readonly state: "queued" | "delivered" | "acknowledged";
  readonly subject: string;
  readonly summary: string;
  readonly payload: unknown;
  readonly reaction_kind: string;
  readonly source_domain: string;
  readonly response_due_at: string | null;
  readonly expires_at: string | null;
  readonly queued_at: string;
  readonly updated_at: string;
}

export interface RelationshipAreaProjection {
  readonly relationship: "self" | "dependent";
  readonly student_id: string;
  readonly student_label: string;
  readonly class_section_id: string | null;
  readonly class_label: string | null;
  readonly enrollment_revision: number | null;
}

export interface WorkspaceRepositorySnapshot {
  readonly institution: { id: string; name: string; code?: string; timezone: string };
  readonly membership_roles: readonly InstitutionMembershipRole[];
  readonly access_scope?: 'campus' | 'assigned_work';
  readonly realm_id: string;
  readonly environment_namespace_id: string;
  readonly acting_agent_id: string | null;
  readonly owner_agent_ids: readonly string[];
  readonly assignments: readonly ResponsibilityAssignmentProjection[];
  readonly messages: readonly OwnedMessageProjection[];
  readonly relationships: readonly RelationshipAreaProjection[];
}
