import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { postgresClientConnectionConfig } from "./connection-policy.js";
import { demoId } from "./seed-operations.js";

export async function seedGovernanceAuthorityDemo(pool: Pool, demoMode: boolean) {
  if (!demoMode) return { skipped: "Demo mode is disabled" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scope = (await client.query(`SELECT school.id,principal.id principal_id,teacher.id teacher_id
      FROM schools school
      JOIN users principal ON principal.username='meera.principal' AND principal.is_active
      JOIN school_memberships principal_membership ON principal_membership.school_id=school.id
        AND principal_membership.user_id=principal.id AND principal_membership.role='admin' AND principal_membership.is_active
      JOIN users teacher ON teacher.username='kavita.staff' AND teacher.is_active
      JOIN school_memberships teacher_membership ON teacher_membership.school_id=school.id
        AND teacher_membership.user_id=teacher.id AND teacher_membership.role='staff' AND teacher_membership.is_active
      WHERE school.code='cis'`)).rows[0];
    if (!scope) {
      await client.query("ROLLBACK");
      return { skipped: "Cambridge demo identities are unavailable" };
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [scope.id]);

    const officialSource = demoId("governance-source-cbse-affiliation");
    const localSource = demoId("governance-source-cis-management-scheme");
    await client.query(`INSERT INTO institution_authority_sources(
      id,school_id,code,title,source_kind,issuer,jurisdiction,reference,provision,evidence_reference,
      verification_state,effective_from,verified_by,verified_at,created_by
    ) VALUES
      ($1,$3,'cbse_affiliation_bye_laws','CBSE Affiliation Bye-Laws 2018','affiliation_rule',
       'Central Board of Secondary Education','India','Affiliation Bye-Laws 2018','Clauses 8.1-8.5 and 9.1-9.3',
       'https://www.cbse.gov.in/cbsenew/aff-bye-laws.html','verified','2018-10-18',$4,now(),$4),
      ($2,$3,'cis_management_scheme','Cambridge International School management scheme','governing_instrument',
       'Cambridge International School Management','Karnataka, India','CIS-GOV-2026-01','Demo management and delegation schedule',
       'Illustrative demo governance record','verified','2026-04-01',$4,now(),$4)
    ON CONFLICT(school_id,code) DO UPDATE SET
      title=EXCLUDED.title,issuer=EXCLUDED.issuer,jurisdiction=EXCLUDED.jurisdiction,
      reference=EXCLUDED.reference,provision=EXCLUDED.provision,evidence_reference=EXCLUDED.evidence_reference,
      verification_state=EXCLUDED.verification_state,effective_from=EXCLUDED.effective_from,
      verified_by=EXCLUDED.verified_by,verified_at=EXCLUDED.verified_at`,
    [officialSource, localSource, scope.id, scope.principal_id]);

    const people = [
      { id: demoId("governance-person-meera-kapoor"), first: "Meera", last: "Kapoor", email: "meera.kapoor@example.test" },
      { id: demoId("governance-person-ramesh-malhotra"), first: "Ramesh", last: "Malhotra", email: "ramesh.malhotra@example.test" },
      { id: demoId("governance-person-kavita-mehta"), first: "Kavita", last: "Mehta", email: "kavita.mehta@example.test" },
    ];
    for (const person of people) await client.query(`INSERT INTO school_people(id,school_id,first_name,last_name,contact_email)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(school_id,id) DO UPDATE SET
      first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,contact_email=EXCLUDED.contact_email`,
    [person.id, scope.id, person.first, person.last, person.email]);

    const principalOffice = demoId("governance-office-principal");
    const managerOffice = demoId("governance-office-manager");
    await client.query(`INSERT INTO institution_governance_offices(id,school_id,code,title,purpose,authority_source_id,status,created_by)
      VALUES
      ($1,$3,'principal','Principal','Lead academic and administrative operations within the applicable scheme and delegations.',$4,'active',$5),
      ($2,$3,'manager','Manager / correspondent','Connect management, the School Management Committee and the head of school within recorded authority.',$4,'active',$5)
      ON CONFLICT(school_id,code) DO UPDATE SET title=EXCLUDED.title,purpose=EXCLUDED.purpose,
        authority_source_id=EXCLUDED.authority_source_id,status='active'`,
    [principalOffice, managerOffice, scope.id, localSource, scope.principal_id]);

    const managementBody = demoId("governance-body-management");
    const smcBody = demoId("governance-body-smc");
    await client.query(`INSERT INTO institution_governance_bodies(id,school_id,code,title,purpose,authority_source_id,collective_authority,status,created_by)
      VALUES
      ($1,$3,'management_entity','Management entity','Exercise the management powers and final decisions recorded in the governing instruments.',$4,true,'active',$5),
      ($2,$3,'school_management_committee','School Management Committee','Review and decide school matters within the applicable CBSE, government and institution rules.',$6,true,'active',$5)
      ON CONFLICT(school_id,code) DO UPDATE SET title=EXCLUDED.title,purpose=EXCLUDED.purpose,
        authority_source_id=EXCLUDED.authority_source_id,status='active'`,
    [managementBody, smcBody, scope.id, localSource, scope.principal_id, officialSource]);

    const seats = [
      { id: demoId("governance-seat-smc-principal"), code: "principal_member_secretary", title: "Principal - member secretary", kind: "ex_officio", vote: "conditional", office: principalOffice, order: 10 },
      { id: demoId("governance-seat-smc-manager"), code: "management_nominee_chair", title: "Management nominee / chair", kind: "chair", vote: "voting", office: null, order: 20 },
      { id: demoId("governance-seat-smc-teacher"), code: "teacher_representative", title: "Teacher representative", kind: "ordinary", vote: "voting", office: null, order: 30 },
    ];
    for (const seat of seats) await client.query(`INSERT INTO institution_governance_seats(
      id,school_id,body_id,code,title,seat_kind,voting_right,qualifying_office_id,required,term_months,status,sort_order,created_by
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9,'active',$10,$11)
      ON CONFLICT(school_id,body_id,code) DO UPDATE SET title=EXCLUDED.title,seat_kind=EXCLUDED.seat_kind,
        voting_right=EXCLUDED.voting_right,qualifying_office_id=EXCLUDED.qualifying_office_id,status='active',sort_order=EXCLUDED.sort_order`,
    [seat.id, scope.id, smcBody, seat.code, seat.title, seat.kind, seat.vote, seat.office, seat.kind === "ex_officio" ? null : 36, seat.order, scope.principal_id]);

    const appointments = [
      { id: demoId("governance-appointment-principal"), office: principalOffice, seat: null, person: people[0]!.id, user: scope.principal_id, kind: "appointed", source: localSource, evidence: "CIS/APPT/PRINCIPAL/2026" },
      { id: demoId("governance-appointment-manager"), office: managerOffice, seat: null, person: people[1]!.id, user: null, kind: "appointed", source: localSource, evidence: "CIS/APPT/MANAGER/2026" },
      { id: demoId("governance-appointment-smc-principal"), office: null, seat: seats[0]!.id, person: people[0]!.id, user: scope.principal_id, kind: "ex_officio", source: officialSource, evidence: "Ex-officio through Principal office" },
      { id: demoId("governance-appointment-smc-chair"), office: null, seat: seats[1]!.id, person: people[1]!.id, user: null, kind: "nominated", source: localSource, evidence: "CIS/SMC/NOM/2026-01" },
      { id: demoId("governance-appointment-smc-teacher"), office: null, seat: seats[2]!.id, person: people[2]!.id, user: scope.teacher_id, kind: "nominated", source: localSource, evidence: "CIS/SMC/NOM/2026-02" },
    ];
    for (const appointment of appointments) await client.query(`INSERT INTO institution_governance_appointments(
      id,school_id,office_id,seat_id,person_id,linked_user_id,appointment_kind,starts_on,ends_on,status,
      authority_source_id,evidence_reference,created_by
    ) VALUES($1,$2,$3,$4,$5,$6,$7,'2026-04-01','2029-03-31','active',$8,$9,$10)
      ON CONFLICT(id) DO UPDATE SET person_id=EXCLUDED.person_id,linked_user_id=EXCLUDED.linked_user_id,
        status='active',authority_source_id=EXCLUDED.authority_source_id,evidence_reference=EXCLUDED.evidence_reference`,
    [appointment.id, scope.id, appointment.office, appointment.seat, appointment.person, appointment.user,
      appointment.kind, appointment.source, appointment.evidence, scope.principal_id]);

    const classTeacherType = (await client.query(`SELECT id FROM staff_responsibility_types
      WHERE school_id=$1 AND code='class_teacher'`, [scope.id])).rows[0]?.id;
    if (!classTeacherType) throw new Error("Cambridge class-teacher responsibility is unavailable");
    const attendanceMandate = demoId("governance-mandate-attendance");
    const principalConcessionMandate = demoId("governance-mandate-principal-concession");
    await client.query(`INSERT INTO institution_authority_mandates(
      id,school_id,code,title,authority_source_id,holder_office_id,holder_body_id,responsibility_type_id,
      powers,matter_codes,limit_summary,conditions,effective_from,status,created_by
    ) VALUES
      ($1,$3,'class_attendance_operations','Class attendance operations',$4,null,null,$5,
       ARRAY['execute']::text[],ARRAY['daily_attendance']::text[],'Assigned class, active dates and published attendance policy only',
       '{"requires_active_assignment":true,"requires_published_policy":true}'::jsonb,'2026-04-01','active',$6),
      ($2,$3,'principal_fee_concession','Principal fee-concession delegation',$4,$7,null,null,
       ARRAY['decide']::text[],ARRAY['individual_fee_concession']::text[],'Up to INR 25,000 per learner in the 2026-27 academic year',
       '{"currency":"INR","maximum_minor_units":2500000,"period":"2026-27"}'::jsonb,'2026-04-01','active',$6)
      ON CONFLICT(school_id,code) DO UPDATE SET title=EXCLUDED.title,authority_source_id=EXCLUDED.authority_source_id,
        powers=EXCLUDED.powers,matter_codes=EXCLUDED.matter_codes,limit_summary=EXCLUDED.limit_summary,
        conditions=EXCLUDED.conditions,status='active'`,
    [attendanceMandate, principalConcessionMandate, scope.id, localSource, classTeacherType, scope.principal_id, principalOffice]);

    const rules = [
      { id: demoId("governance-rule-daily-attendance"), code: "daily_attendance", title: "Daily attendance", category: "operations", initiate: "Assigned class teacher opens the current roster.", review: "Corrections follow the published attendance correction route.", decide: "Standing authority from the published attendance policy and current class assignment.", execute: "The assigned class teacher records attendance for the named class and date.", mode: "standing", office: null, body: null, mandate: attendanceMandate, sources: [localSource], conditions: "No new committee case is required for each normal register.", fields: ["class_section", "attendance_date", "policy_version"] },
      { id: demoId("governance-rule-fee-concession"), code: "individual_fee_concession", title: "Individual fee concession", category: "finance", initiate: "Finance staff prepares the learner-specific request and evidence.", review: "Finance verifies the applicable fee plan and prior use.", decide: "Principal may decide only within the recorded ceiling and period.", execute: "Finance posts the exact approved adjustment once.", mode: "delegated", office: principalOffice, body: null, mandate: null, sources: [localSource], conditions: "Requests above the ceiling use the reserved financial route.", fields: ["learner", "amount", "fee_plan_version"] },
      { id: demoId("governance-rule-annual-budget"), code: "annual_budget", title: "Annual budget", category: "finance", initiate: "Principal prepares and presents the versioned budget.", review: "School Management Committee reviews the budget and records its recommendation.", decide: "Management entity approves the budget under the recorded governing route.", execute: "Authorised finance staff implement the adopted budget and conditions.", mode: "combined", office: null, body: managementBody, mandate: null, sources: [officialSource, localSource], conditions: "The SMC review and management decision remain separate facts.", fields: ["budget_version", "financial_year", "total_amount"] },
      { id: demoId("governance-rule-fee-policy"), code: "fee_policy_revision", title: "Fee-policy revision", category: "policy", initiate: "Management prepares the versioned proposal and impact summary.", review: "The applicable State/UT route and CBSE requirements are checked for this institution.", decide: "School Management Committee approval or the applicable government-prescribed process is required.", execute: "The approved schedule is published only for its authorised effective period.", mode: "combined", office: null, body: smcBody, mandate: null, sources: [officialSource, localSource], conditions: "Do not treat this demo route as a universal fee rule; confirm current Karnataka requirements.", fields: ["fee_schedule_version", "affected_population", "effective_date"] },
      { id: demoId("governance-rule-safety-direction"), code: "school_safety_direction", title: "School safety direction", category: "safety", initiate: "Principal or designated safety owner prepares the issue and evidence.", review: "School Management Committee reviews safety and security implications.", decide: "The applicable authority records the required direction.", execute: "Named operational owners complete actions and submit evidence for verification.", mode: "collective", office: null, body: smcBody, mandate: null, sources: [officialSource, localSource], conditions: "Emergency protective action remains available within existing duties.", fields: ["finding", "action_owner", "due_date"] },
    ];
    for (const rule of rules) await client.query(`INSERT INTO institution_decision_matter_rules(
      id,school_id,code,title,category,initiation_summary,review_summary,decision_summary,execution_summary,
      decision_mode,decision_office_id,decision_body_id,standing_mandate_id,authority_source_ids,
      conditions_summary,material_fields,status,effective_from,created_by
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'confirmed','2026-04-01',$17)
      ON CONFLICT(school_id,code) DO UPDATE SET title=EXCLUDED.title,category=EXCLUDED.category,
        initiation_summary=EXCLUDED.initiation_summary,review_summary=EXCLUDED.review_summary,
        decision_summary=EXCLUDED.decision_summary,execution_summary=EXCLUDED.execution_summary,
        decision_mode=EXCLUDED.decision_mode,decision_office_id=EXCLUDED.decision_office_id,
        decision_body_id=EXCLUDED.decision_body_id,standing_mandate_id=EXCLUDED.standing_mandate_id,
        authority_source_ids=EXCLUDED.authority_source_ids,conditions_summary=EXCLUDED.conditions_summary,
        material_fields=EXCLUDED.material_fields,status='confirmed'`,
    [rule.id, scope.id, rule.code, rule.title, rule.category, rule.initiate, rule.review, rule.decide,
      rule.execute, rule.mode, rule.office, rule.body, rule.mandate, rule.sources, rule.conditions, rule.fields, scope.principal_id]);

    await client.query("COMMIT");
    return { school_id: scope.id, sources: 2, offices: 2, bodies: 2, appointments: appointments.length, decision_rules: rules.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.DEMO_MODE !== "true") throw new Error("Governance authority demo seeding requires DEMO_MODE=true");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const environment = process.env.DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
  const connection = postgresClientConnectionConfig(process.env.DATABASE_URL, {
    name: "DATABASE_URL", purpose: "migrations", requireRemoteTls: environment === "stage" || environment === "production",
  });
  const pool = new Pool({ ...connection, max: 1, application_name: "omnischool_governance_authority_demo" });
  try {
    process.stdout.write(`Governance authority demo seed: ${JSON.stringify(await seedGovernanceAuthorityDemo(pool, true))}\n`);
  } finally {
    await pool.end();
  }
}
