import { ConflictException, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { AuthUser } from "../common/request.js";
import type { Database } from "../database/types.js";
import type { ParticipationStatus } from "./activity-attendance.contracts.js";

export type OwningParticipationSource = "event" | "examination";
export interface ParticipationSourceContext {
  id: string; school_id: string; occurrence_id: string; source: string; source_ref: string; source_revision: number;
  context_ref: string | null; local_date: string; starts_at: Date; ends_at: Date; timezone: string;
}
export interface ParticipationSourceAuthority {
  can_view: boolean; can_record: boolean; can_review: boolean;
  source_refs: Array<Record<string, unknown>>;
  allowed_statuses: ParticipationStatus[];
  record_not_before?: Date | undefined;
  capture_window?: { from: Date; until: Date } | undefined;
  source: { domain: string; href: string; label: string };
}
export interface ParticipationOwningAdapter {
  owning_adapter: OwningParticipationSource;
  context_fingerprint?: string | undefined;
  force_revisions?: boolean | undefined;
}
export type ParticipationSourceEvaluator = (transaction: Transaction<Database>, user: AuthUser,
  context: ParticipationSourceContext) => Promise<ParticipationSourceAuthority>;

/** Owning domains recheck their own invariants; no dependency on their modules. */
@Injectable()
export class ParticipationContextAuthorityRegistry {
  private readonly evaluators = new Map<OwningParticipationSource, ParticipationSourceEvaluator>();
  register(source: OwningParticipationSource, evaluator: ParticipationSourceEvaluator) {
    if (this.evaluators.has(source)) throw new ConflictException(`The ${source} participation adapter is already registered.`);
    this.evaluators.set(source,evaluator);
  }
  evaluate(source: OwningParticipationSource, tx: Transaction<Database>, user: AuthUser, context: ParticipationSourceContext) {
    const evaluator = this.evaluators.get(source);
    if (!evaluator) throw new ConflictException(`The ${source} participation authority adapter is unavailable.`);
    return evaluator(tx,user,context);
  }
}
