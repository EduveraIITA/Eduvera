import { Controller, Get, Post, Param, Req, Module, ForbiddenException, ConflictException, HttpCode } from "@nestjs/common";
import { z } from "zod";
import { sql } from "kysely";
import { DatabaseService } from "../database/database.service.js";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { operatingRules, rulesSchema, type RulesDb } from "./rules.js";

@Controller("api/v1/operating-rules")
export class OperatingRulesController {
  constructor(private readonly db: DatabaseService) {}
  private async authorize(db: RulesDb, user: AuthUser, schoolId: string) {
    if (user.active_school_id && user.active_school_id !== schoolId) throw new ForbiddenException("Switch to this institution first.");
    const rows = await sql`SELECT m.user_id FROM school_memberships m JOIN users u ON u.id=m.user_id
      WHERE m.school_id=${schoolId}::uuid AND m.user_id=${user.id}::uuid AND m.role='admin' AND m.is_active AND u.is_active
      FOR SHARE OF m,u`.execute(db);
    if (!rows.rows.length) throw new ForbiddenException("Only an active institution administrator can change operating rules.");
  }
  @Get(":schoolId")
  async get(@Req() req: AuthenticatedRequest, @Param("schoolId") value: string) {
    const schoolId=z.uuid().parse(value);
    await this.authorize(this.db, req.authUser, schoolId);
    return operatingRules(this.db, schoolId);
  }
  @Post(":schoolId")
  @HttpCode(200)
  async save(@Req() req: AuthenticatedRequest, @Param("schoolId") value: string) {
    const schoolId=z.uuid().parse(value);
    const input=rulesSchema.extend({expected_revision:z.number().int().min(0)}).strict().parse(req.body);
    return this.db.transaction().execute(async db => {
      await this.authorize(db,req.authUser,schoolId);
      await sql`SELECT id FROM schools WHERE id=${schoolId}::uuid FOR UPDATE`.execute(db);
      const before=await operatingRules(db,schoolId);
      if (before.revision!==input.expected_revision) throw new ConflictException("Operating rules changed. Reload before saving.");
      await sql`INSERT INTO institution_operating_rules(school_id,event_entry_hours_before,event_staff_hours_after,journey_lead_minutes,message_edit_minutes,message_attachment_mb,updated_by)
        VALUES(${schoolId}::uuid,${input.event_entry_hours_before},${input.event_staff_hours_after},${input.journey_lead_minutes},${input.message_edit_minutes},${input.message_attachment_mb},${req.authUser.id}::uuid)
        ON CONFLICT(school_id) DO UPDATE SET event_entry_hours_before=excluded.event_entry_hours_before,event_staff_hours_after=excluded.event_staff_hours_after,
        journey_lead_minutes=excluded.journey_lead_minutes,message_edit_minutes=excluded.message_edit_minutes,message_attachment_mb=excluded.message_attachment_mb,
        updated_by=excluded.updated_by,updated_at=now(),revision=institution_operating_rules.revision+1`.execute(db);
      await sql`UPDATE schools SET attendance_submission_cutoff=${input.attendance_submission_cutoff}::time WHERE id=${schoolId}::uuid`.execute(db);
      const after=await operatingRules(db,schoolId);
      await db.insertInto("audit_events").values({actor_id:req.authUser.id,school_id:schoolId,action:"operating_rules.updated",target_type:"school",target_id:schoolId,request_id:req.requestId,ip_hash:null,metadata:{before,after}}).execute();
      return after;
    });
  }
}
@Module({controllers:[OperatingRulesController]})
export class OperatingRulesModule {}
