var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { sql } from "kysely";
import { z } from "zod";
import { AuditService } from "../common/audit.service.js";
import { CAMPUS_MODEL_CORE_PORT } from "../campus-model-core/campus-model-core.port.js";
import { DatabaseService } from "../database/database.service.js";
import { ProgressiveWorkspaceProvisioner } from "./progressive-workspace.provisioner.js";
import { canonicalProgressiveGoalDestination } from "./progressive-goal-destination.js";
import { HUMAN_AGENT_IDENTITY_PORT } from "../campus-model-core/human-agent-identity.port.js";
import { executionEnvironmentStorage } from "../campus-model-core/execution-time.runtime.js";
import { parseActivityPlanContinuation, readTimetablePlanningReadiness, resolveActivityPlanContinuation, timetableSetupPath, vettedTimetableResume } from "../schedule-planning/activity-planning-readiness.js";
import { parseAssignmentContinuation, readAssignmentsReadiness, resolveAssignmentContinuation, vettedAssignmentsResume } from "../learning/learning-assignment-readiness.js";
import { feesHubPath, feesSetupPath, parseFeesContinuation, readFeesReadiness, resolveFeesContinuation, vettedFeesResume } from "../operations/fees-first-readiness.js";
import { resourceLoansPath, resourceLoansSetupPath, parseResourceLoanContinuation, readResourceLoansReadiness, resolveResourceLoanContinuation, vettedResourceLoansResume } from "../resource-loans/resource-loan-readiness.js";
import { facilitiesPath, facilitiesSetupPath, parseFacilitiesContinuation, readFacilitiesReadiness, resolveFacilitiesContinuation, vettedFacilitiesResume } from "./facilities-readiness.js";
import { accommodationPath, accommodationSetupPath, parseAccommodationContinuation, readAccommodationReadiness, resolveAccommodationContinuation, vettedAccommodationResume } from "./accommodation-readiness.js";
import { diningPath, diningSetupPath, parseDiningContinuation, readDiningReadiness, resolveDiningContinuation, vettedDiningResume } from "./dining-readiness.js";
import { goalKey, onboardingTimezone as timezone, provisionWorkspaceSchema, updateStartingGoalsSchema, wholeCampusGuidancePath, wholeCampusGuidanceResume } from "./progressive-onboarding.contracts.js";
const updateResume = z.object({
    step: z.enum(["purpose", "first_use", "operating"]), goal: goalKey.nullable().optional(),
    path: z.string().trim().regex(/^\/[A-Za-z0-9_?&=./:%-]*$/).max(180),
}).strict();
const updateProfile = z.object({ display_name: z.string().trim().min(2).max(180), timezone: timezone.optional() }).strict();
const code = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,31}$/);
const formalApplication = z.object({
    application_id: z.uuid().optional(), school_id: z.uuid().optional(), institution_name: z.string().trim().min(2).max(180),
    requested_code: code.optional(), institution_kind: z.enum(["school", "college", "coaching", "hybrid"]), timezone: timezone.optional(),
    state_code: z.string().trim().min(2).max(12).transform((value) => value.toUpperCase()), district: z.string().trim().min(2).max(120),
    website: z.union([z.literal(""), z.url().max(240)]).default(""), applicant_role_title: z.string().trim().min(2).max(120),
    regulator_type: z.enum(["udise", "aishe", "board_affiliation", "trust_registration", "other"]),
    regulator_reference: z.string().trim().min(3).max(180), declaration_accepted: z.literal(true),
}).strict();
let InstitutionOnboardingService = class InstitutionOnboardingService {
    db;
    audit;
    provisioner;
    campusModel;
    identities;
    constructor(db, audit, provisioner, campusModel, identities) {
        this.db = db;
        this.audit = audit;
        this.provisioner = provisioner;
        this.campusModel = campusModel;
        this.identities = identities;
    }
    async selectedWorkspace(user, db = this.db) {
        const result = await sql `SELECT progressive.id AS workspace_id,school.id AS school_id,
        school.name,school.code,school.timezone,school.onboarding_model,school.verification_status,
        school.created_at,progressive.profile_named,progressive.status,progressive.resume_step,
        progressive.resume_goal_key,progressive.resume_path,progressive.updated_at AS resume_updated_at,progressive.owner_user_id AS resume_owner_user_id,
        progressive.guidance
      FROM school_memberships membership JOIN schools school ON school.id=membership.school_id
      LEFT JOIN progressive_onboarding_workspaces progressive ON progressive.school_id=school.id
      WHERE membership.user_id=${user.id}::uuid AND membership.role='admin' AND membership.is_active AND membership.access_scope='campus'
        AND (${user.active_school_id ?? null}::uuid IS NULL OR school.id=${user.active_school_id ?? null}::uuid)
      ORDER BY (school.id=${user.active_school_id ?? null}::uuid) DESC,
        (progressive.provisioned_for_account_id=${user.id}::uuid) DESC,membership.created_at ASC LIMIT 1`.execute(db);
        return result.rows[0] ?? null;
    }
    async requireAdminWorkspace(user, db = this.db) {
        const workspace = await this.selectedWorkspace(user, db);
        if (!workspace)
            throw new NotFoundException("Create your private workspace before continuing.");
        if (user.active_school_id && workspace.school_id !== user.active_school_id) {
            throw new ForbiddenException("The selected workspace is not your active administrator workspace.");
        }
        return workspace;
    }
    requireLivePreferences(request) {
        const context = request;
        if (executionEnvironmentStorage.getStore()?.kind === "simulation"
            || context?.executionEnvironment?.kind === "simulation" || context?.executionEnvironmentView?.mode === "simulation") {
            throw new ForbiddenException("Account onboarding continues in Live, not in a rehearsal.");
        }
        if (context?.publicDemo || context?.internalAgentDelegation || context?.hostedCampusSimulator) {
            throw new ForbiddenException("Use your own signed-in account to change your campus starting points.");
        }
    }
    async ensureProgressiveRecord(db, user, workspace) {
        if (workspace.workspace_id)
            return workspace.workspace_id;
        return (await sql `INSERT INTO progressive_onboarding_workspaces(
        school_id,owner_user_id,profile_named,status,resume_step,resume_path
      ) VALUES(${workspace.school_id}::uuid,${user.id}::uuid,true,'ready','operating','/today')
      ON CONFLICT(school_id) DO UPDATE SET school_id=EXCLUDED.school_id RETURNING id`.execute(db)).rows[0].id;
    }
    async catalogue(db = this.db) {
        return (await sql `
      SELECT goal_key AS key,label,description,destination,setup_capability,sort_order
      FROM progressive_onboarding_goal_catalog WHERE is_active ORDER BY sort_order,goal_key`.execute(db)).rows
            .map((item) => ({ ...item, destination: canonicalProgressiveGoalDestination(item.key, item.destination) }));
    }
    async snapshot(user, db = this.db, selected) {
        const workspace = selected === undefined ? await this.selectedWorkspace(user, db) : selected;
        const definitions = await this.catalogue(db);
        const selections = workspace?.workspace_id ? (await sql `
      SELECT goal_key,priority,updated_at FROM progressive_onboarding_goal_selections
      WHERE workspace_id=${workspace.workspace_id}::uuid ORDER BY priority`.execute(db)).rows : [];
        const chosen = selections.map((item) => item.goal_key);
        const applications = (await sql `SELECT id,workspace_school_id,institution_name,requested_code,institution_kind,timezone,
        state_code,district,website,applicant_role_title,regulator_type,regulator_reference,status,
        review_note,revision,submitted_at,updated_at,provisioned_school_id
      FROM institution_onboarding_applications WHERE applicant_user_id=${user.id}::uuid
        OR workspace_school_id=${workspace?.school_id ?? null}::uuid ORDER BY created_at DESC`.execute(db)).rows;
        const status = !workspace ? "workspace_required"
            : workspace.status === "purpose_required" && !chosen.length ? "purpose_required" : "ready";
        const catalogue = definitions.map((item) => ({
            key: item.key, label: item.label, description: item.description, destination: item.destination,
            setup_capability: item.setup_capability, selection_kind: "goal", selected: chosen.includes(item.key),
            availability: chosen.includes(item.key) ? "start_here" : "add_anytime",
        }));
        catalogue.push({ key: "whole_campus", label: "My whole campus", description: "Start with a connected progressive plan across the campus.",
            destination: wholeCampusGuidancePath, setup_capability: null, selection_kind: "shortcut",
            selected: workspace?.guidance === "whole_campus", availability: "add_anytime" }, { key: "explore", label: "Just explore", description: "Open the safe product demo without creating operational records.",
            destination: "/demo", setup_capability: null, selection_kind: "demo", selected: false, availability: "add_anytime" });
        const resumePath = workspace?.resume_path ?? (chosen.length ? "/today" : "/onboarding/start");
        const timetableResume = workspace?.resume_goal_key === "timetable" && workspace.resume_step !== "purpose"
            ? await vettedTimetableResume(db, this.identities, user, { school_id: workspace.school_id, owner_user_id: workspace.resume_owner_user_id,
                resume_step: workspace.resume_step ?? "first_use", resume_path: resumePath }) : null;
        const assignmentsResume = workspace?.resume_goal_key === "assignments" && workspace.resume_step !== "purpose"
            ? await vettedAssignmentsResume(db, this.identities, user, { school_id: workspace.school_id, owner_user_id: workspace.resume_owner_user_id,
                resume_step: workspace.resume_step ?? "first_use", resume_path: resumePath }) : null;
        const feesResume = workspace?.resume_goal_key === "fees" && workspace.resume_step !== "purpose"
            ? await vettedFeesResume(db, this.identities, user, { school_id: workspace.school_id, owner_user_id: workspace.resume_owner_user_id,
                resume_step: workspace.resume_step ?? "first_use", resume_path: resumePath }) : null;
        const resourcesResume = workspace?.resume_goal_key === "resources" && workspace.resume_step !== "purpose"
            ? await vettedResourceLoansResume(db, this.identities, user, { school_id: workspace.school_id,
                owner_user_id: workspace.resume_owner_user_id, resume_path: resumePath }) : null;
        const facilitiesResume = workspace?.resume_goal_key === "facilities" && workspace.resume_step !== "purpose"
            ? await vettedFacilitiesResume(db, this.identities, user, { school_id: workspace.school_id,
                owner_user_id: workspace.resume_owner_user_id, resume_path: resumePath }) : null;
        const accommodationResume = workspace?.resume_goal_key === "accommodation" && workspace.resume_step !== "purpose"
            ? await vettedAccommodationResume(db, this.identities, user, { school_id: workspace.school_id,
                owner_user_id: workspace.resume_owner_user_id, resume_path: resumePath }) : null;
        const diningResume = workspace?.resume_goal_key === "dining" && workspace.resume_step !== "purpose"
            ? await vettedDiningResume(db, this.identities, user, { school_id: workspace.school_id,
                owner_user_id: workspace.resume_owner_user_id, resume_path: resumePath }) : null;
        return {
            status,
            guidance: workspace?.guidance ?? null,
            guidance_resume: wholeCampusGuidanceResume(user, workspace ? { ...workspace, owner_user_id: workspace.resume_owner_user_id } : null, executionEnvironmentStorage.getStore()?.kind !== "simulation"),
            workspace: workspace ? { id: workspace.school_id, display_name: workspace.profile_named === false ? "Your campus" : workspace.name,
                profile_named: workspace.profile_named ?? true, timezone: workspace.timezone, onboarding_model: workspace.onboarding_model,
                verification_status: workspace.verification_status, created_at: workspace.created_at } : null,
            goals: { selected: chosen, primary: selections[0]?.goal_key ?? null,
                updated_at: selections.reduce((latest, item) => !latest || new Date(item.updated_at) > new Date(latest) ? item.updated_at : latest, null) },
            resume: workspace ? Object.assign({ step: workspace.resume_step ?? (chosen.length ? "operating" : "purpose"), workspace_id: workspace.school_id,
                goal: workspace.resume_goal_key, path: workspace.resume_step === "first_use"
                    ? canonicalProgressiveGoalDestination(workspace.resume_goal_key, resumePath) : resumePath,
                updated_at: workspace.resume_updated_at ?? workspace.created_at }, timetableResume ?? {}, assignmentsResume ?? {}, feesResume ?? {}, resourcesResume ?? {}, facilitiesResume ?? {}, accommodationResume ?? {}, diningResume ?? {})
                : { step: "purpose", workspace_id: null, goal: null, path: "/onboarding/start", updated_at: null },
            catalogue, applications,
        };
    }
    async workspace(user) { return this.snapshot(user); }
    hasSourceContinuation(workspace) {
        const path = workspace.resume_path;
        return Boolean(path && (parseActivityPlanContinuation(path) || parseAssignmentContinuation(path) || parseFeesContinuation(path)
            || parseResourceLoanContinuation(path) || parseFacilitiesContinuation(path) || parseAccommodationContinuation(path) || parseDiningContinuation(path)));
    }
    async saveGuidance(db, user, workspace, guidance) {
        const workspaceId = await this.ensureProgressiveRecord(db, user, workspace);
        const current = (await sql `SELECT guidance FROM progressive_onboarding_workspaces
      WHERE id=${workspaceId}::uuid FOR UPDATE`.execute(db)).rows[0];
        if (current.guidance === guidance)
            return;
        const state = (await sql `UPDATE progressive_onboarding_workspaces SET guidance=${guidance},
      status=CASE WHEN ${guidance}::text='whole_campus' THEN 'ready' ELSE status END,
      revision=revision+1,updated_at=now() WHERE id=${workspaceId}::uuid RETURNING revision`.execute(db)).rows[0];
        await sql `INSERT INTO progressive_onboarding_audits(workspace_id,actor_id,action,revision,metadata)
      VALUES(${workspaceId}::uuid,${user.id}::uuid,'guidance_selected',${state.revision},${JSON.stringify({ guidance })}::jsonb)`.execute(db);
    }
    async replaceGoals(db, user, workspace, goals, primary, preserveSourceResume = false) {
        const workspaceId = await this.ensureProgressiveRecord(db, user, workspace);
        if (preserveSourceResume) {
            const current = (await sql `
        SELECT resume_step,resume_goal_key,resume_path FROM progressive_onboarding_workspaces
        WHERE id=${workspaceId}::uuid FOR UPDATE`.execute(db)).rows[0];
            Object.assign(workspace, current);
        }
        const ordered = primary ? [primary, ...goals.filter((goal) => goal !== primary)] : goals;
        const available = await this.catalogue(db);
        const allowed = new Set(available.map((item) => item.key));
        if (ordered.some((item) => !allowed.has(item)))
            throw new BadRequestException("One selected outcome is unavailable.");
        // Replacing the small ordered set avoids transient UNIQUE(workspace_id,priority)
        // collisions when an operator changes the primary outcome or reorders goals.
        // The audited workspace revision is the history; selections are current state.
        await sql `DELETE FROM progressive_onboarding_goal_selections
      WHERE workspace_id=${workspaceId}::uuid`.execute(db);
        for (const [index, key] of ordered.entries()) {
            await sql `INSERT INTO progressive_onboarding_goal_selections(workspace_id,goal_key,priority,selected_by)
        VALUES(${workspaceId}::uuid,${key},${index + 1},${user.id}::uuid)
        `.execute(db);
        }
        const nextPath = available.find((item) => item.key === ordered[0])?.destination ?? "/today";
        const preserve = preserveSourceResume && this.hasSourceContinuation(workspace);
        const state = (await sql `UPDATE progressive_onboarding_workspaces SET
        status='ready',resume_step=CASE WHEN ${preserve} THEN resume_step ELSE 'first_use' END,
        resume_goal_key=CASE WHEN ${preserve} THEN resume_goal_key ELSE ${ordered[0]} END,
        resume_path=CASE WHEN ${preserve} THEN resume_path ELSE ${nextPath} END,
        revision=revision+1,updated_at=now() WHERE id=${workspaceId}::uuid RETURNING revision`.execute(db)).rows[0];
        await sql `INSERT INTO progressive_onboarding_audits(workspace_id,actor_id,action,revision,metadata)
      VALUES(${workspaceId}::uuid,${user.id}::uuid,'goals_selected',${state.revision},
        ${JSON.stringify({ goals: ordered, primary: ordered[0] })}::jsonb)`.execute(db);
    }
    async provision(user, sessionHash, body, request) {
        this.requireLivePreferences(request);
        const input = provisionWorkspaceSchema.parse(body ?? {});
        const result = await this.db.transaction().execute(async (db) => {
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`progressive-workspace:${user.id}`},0))`.execute(db);
            let existing = await this.selectedWorkspace(user, db);
            let created = false;
            if (!existing) {
                if (user.active_school_id)
                    throw new ForbiddenException("Current campus setup requires active administrator access. No new campus was created.");
                const retained = (await sql `SELECT 1 FROM progressive_onboarding_workspaces WHERE provisioned_for_account_id=${user.id}::uuid
          UNION ALL SELECT 1 FROM school_memberships WHERE user_id=${user.id}::uuid AND is_active LIMIT 1`.execute(db)).rows.length > 0;
                if (retained)
                    throw new ForbiddenException("Return to an authorized campus context to continue setup. No new campus was created.");
                const createdId = await this.provisioner.createForAccount(db, user, input.timezone ?? "UTC");
                existing = await this.selectedWorkspace({ ...user, active_school_id: createdId }, db);
                created = true;
            }
            if (!existing)
                throw new ConflictException("The private workspace could not be resolved.");
            if (input.timezone && existing.workspace_id && existing.onboarding_model === "progressive_private"
                && existing.timezone !== input.timezone) {
                await sql `UPDATE schools SET timezone=${input.timezone} WHERE id=${existing.school_id}::uuid`.execute(db);
                existing.timezone = input.timezone;
            }
            if (input.goals)
                await this.replaceGoals(db, user, existing, input.goals, undefined, input.guidance === "whole_campus");
            if (input.guidance !== undefined)
                await this.saveGuidance(db, user, existing, input.guidance);
            await sql `UPDATE auth_sessions SET active_school_id=${existing.school_id}::uuid
        WHERE token_hash=${sessionHash} AND user_id=${user.id}::uuid`.execute(db);
            return { schoolId: existing.school_id, created };
        });
        await this.audit.record({ action: result.created ? "institution.progressive_workspace.provisioned" : "institution.progressive_workspace.selected",
            request, actorId: user.id, schoolId: result.schoolId, targetType: "school", targetId: result.schoolId,
            metadata: { idempotent: true, goals: input.goals ?? [], timezone: input.timezone ?? null,
                ...(input.guidance !== undefined ? { guidance: input.guidance } : {}) } });
        return { active_school_id: result.schoolId, ...await this.snapshot({ ...user, active_school_id: result.schoolId }) };
    }
    async setGoals(user, body, request) {
        this.requireLivePreferences(request);
        const input = updateStartingGoalsSchema.parse(body);
        const schoolId = await this.db.transaction().execute(async (db) => {
            const workspace = await this.requireAdminWorkspace(user, db);
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`progressive-goals:${workspace.school_id}`},0))`.execute(db);
            await this.replaceGoals(db, user, workspace, input.goals, input.primary, input.guidance === "whole_campus");
            if (input.guidance !== undefined)
                await this.saveGuidance(db, user, workspace, input.guidance);
            return workspace.school_id;
        });
        await this.audit.record({ action: "institution.progressive_goals.selected", request, actorId: user.id,
            schoolId, targetType: "school", targetId: schoolId, metadata: input });
        return this.snapshot({ ...user, active_school_id: schoolId });
    }
    async setResume(user, body, request) {
        this.requireLivePreferences(request);
        const input = updateResume.parse(body);
        if (input.path === wholeCampusGuidancePath) {
            const workspace = await this.requireAdminWorkspace(user);
            if (input.step !== "first_use" || input.goal || workspace.guidance !== "whole_campus")
                throw new BadRequestException("Choose whole-campus guidance before continuing its setup.");
            // Opening the guide is not acceptance of a new domain source and must not
            // erase a timetable, assignment or other exact source continuation.
            return this.snapshot(user);
        }
        let resumeStep = input.step;
        let resumePath = input.step === "first_use"
            ? canonicalProgressiveGoalDestination(input.goal ?? null, input.path) : input.path;
        const schoolId = await this.db.transaction().execute(async (db) => {
            const workspace = await this.requireAdminWorkspace(user, db);
            const workspaceId = await this.ensureProgressiveRecord(db, user, workspace);
            const current = (await sql `
        SELECT resume_step,resume_goal_key,resume_path,owner_user_id AS resume_owner_user_id
        FROM progressive_onboarding_workspaces WHERE id=${workspaceId}::uuid FOR UPDATE`.execute(db)).rows[0];
            Object.assign(workspace, current);
            if (workspace.resume_goal_key === "timetable" && workspace.resume_path && parseActivityPlanContinuation(workspace.resume_path)
                && workspace.resume_owner_user_id !== user.id)
                throw new ForbiddenException("Another administrator's first-use continuation cannot be replaced.");
            if (workspace.resume_goal_key === "assignments" && workspace.resume_path && parseAssignmentContinuation(workspace.resume_path)
                && workspace.resume_owner_user_id !== user.id)
                throw new ForbiddenException("Another administrator's first-use continuation cannot be replaced.");
            if (workspace.resume_goal_key === "fees" && workspace.resume_path && parseFeesContinuation(workspace.resume_path)
                && workspace.resume_owner_user_id !== user.id)
                throw new ForbiddenException("Another administrator's first-use continuation cannot be replaced.");
            if (input.goal) {
                const selected = await sql `SELECT 1 FROM progressive_onboarding_goal_selections
          WHERE workspace_id=${workspaceId}::uuid AND goal_key=${input.goal}`.execute(db);
                if (!selected.rows.length)
                    throw new BadRequestException("Resume can only target a selected outcome.");
            }
            if (input.goal === "timetable") {
                if (workspace.resume_owner_user_id && workspace.resume_owner_user_id !== user.id)
                    throw new ForbiddenException("Another administrator's first-use continuation cannot be replaced.");
                const source = await resolveActivityPlanContinuation(db, this.identities, user, workspace.school_id, resumePath);
                if (source) {
                    if (input.step === "operating" && source.source.state === "draft")
                        throw new BadRequestException("Publish the activity before marking this outcome as operating.");
                    resumePath = source.path;
                }
                else {
                    if (input.step !== "first_use" || ![timetableSetupPath, "/areas/timetable/planning?create=activity"].includes(resumePath)) {
                        throw new BadRequestException("Choose an accessible activity plan or the timetable setup guide.");
                    }
                    if (!this.identities)
                        throw new ForbiddenException("A current campus identity is required.");
                    const readiness = await readTimetablePlanningReadiness(db, this.identities, user, workspace.school_id);
                    if (readiness.operation.action === "unavailable")
                        throw new ForbiddenException("A current timetable responsibility is required.");
                    // Older setup pages save a generic first-use path on mount. They must
                    // not erase an accepted, still-accessible exact draft continuation.
                    if (workspace.resume_goal_key === "timetable"
                        && workspace.resume_path && parseActivityPlanContinuation(workspace.resume_path)) {
                        const retained = await resolveActivityPlanContinuation(db, this.identities, user, workspace.school_id, workspace.resume_path);
                        if (retained) {
                            resumePath = retained.path;
                            resumeStep = retained.source.state === "draft" ? "first_use" : "operating";
                        }
                    }
                }
            }
            if (input.goal === "assignments") {
                if (workspace.resume_owner_user_id && workspace.resume_owner_user_id !== user.id)
                    throw new ForbiddenException("Another administrator's first-use continuation cannot be replaced.");
                const source = await resolveAssignmentContinuation(db, this.identities, user, workspace.school_id, resumePath);
                if (source) {
                    if (input.step === "operating" && source.source.state === "draft")
                        throw new BadRequestException("Publish the assignment before marking this outcome as operating.");
                    resumePath = source.path;
                }
                else {
                    if (input.step !== "first_use" || !["/more/setup/capabilities?task=assignments", "/areas/messages/assignments"].includes(resumePath)) {
                        throw new BadRequestException("Choose an accessible assignment or the assignments setup guide.");
                    }
                    if (!this.identities)
                        throw new ForbiddenException("A current campus identity is required.");
                    const readiness = await readAssignmentsReadiness(db, this.identities, user, workspace.school_id);
                    if (readiness.operation.state === "unavailable")
                        throw new ForbiddenException("A current assignment responsibility or campus setup authority is required.");
                    // A shared setup page cannot erase an accepted exact source. The
                    // source owner remains responsible for its current authority check.
                    if (workspace.resume_goal_key === "assignments" && workspace.resume_path && parseAssignmentContinuation(workspace.resume_path)) {
                        const retained = await resolveAssignmentContinuation(db, this.identities, user, workspace.school_id, workspace.resume_path);
                        if (retained) {
                            resumePath = retained.path;
                            resumeStep = retained.source.state === "draft" ? "first_use" : "operating";
                        }
                    }
                }
            }
            if (input.goal === "fees") {
                if (workspace.resume_owner_user_id && workspace.resume_owner_user_id !== user.id)
                    throw new ForbiddenException("Another administrator's first-use continuation cannot be replaced.");
                const source = await resolveFeesContinuation(db, this.identities, user, workspace.school_id, resumePath);
                if (source) {
                    resumePath = source.path;
                    resumeStep = "operating";
                }
                else {
                    if (input.step !== "first_use" || ![feesSetupPath, feesHubPath].includes(resumePath)) {
                        throw new BadRequestException("Choose your recorded charge or the Fees workspace.");
                    }
                    const readiness = await readFeesReadiness(db, this.identities, user, workspace.school_id);
                    if (readiness.operation.state === "unavailable")
                        throw new ForbiddenException("Current Finance access is required.");
                    if (workspace.resume_goal_key === "fees" && workspace.resume_path && parseFeesContinuation(workspace.resume_path)) {
                        const retained = await resolveFeesContinuation(db, this.identities, user, workspace.school_id, workspace.resume_path);
                        if (retained) {
                            resumePath = retained.path;
                            resumeStep = "operating";
                        }
                    }
                }
            }
            if (workspace.resume_goal_key === "resources" && workspace.resume_path && parseResourceLoanContinuation(workspace.resume_path)
                && workspace.resume_owner_user_id !== user.id)
                throw new ForbiddenException("Another administrator's first-use continuation cannot be replaced.");
            if (input.goal === "resources") {
                if (workspace.resume_owner_user_id && workspace.resume_owner_user_id !== user.id)
                    throw new ForbiddenException("Another administrator's first-use continuation cannot be replaced.");
                const source = await resolveResourceLoanContinuation(db, this.identities, user, workspace.school_id, resumePath);
                if (source) {
                    resumePath = source.path;
                    resumeStep = "operating";
                }
                else {
                    if (input.step !== "first_use" || ![resourceLoansSetupPath, resourceLoansPath].includes(resumePath)) {
                        throw new BadRequestException("Choose your recorded loan or the Resources workspace.");
                    }
                    const readiness = await readResourceLoansReadiness(db, this.identities, user, workspace.school_id);
                    if (readiness.operation.action === "unavailable")
                        throw new ForbiddenException("Current borrowing responsibility or a borrower record is required.");
                    if (workspace.resume_goal_key === "resources" && workspace.resume_path && parseResourceLoanContinuation(workspace.resume_path)) {
                        const retained = await resolveResourceLoanContinuation(db, this.identities, user, workspace.school_id, workspace.resume_path);
                        if (retained) {
                            resumePath = retained.path;
                            resumeStep = "operating";
                        }
                    }
                }
            }
            if (workspace.resume_goal_key === "facilities" && workspace.resume_path && parseFacilitiesContinuation(workspace.resume_path)
                && workspace.resume_owner_user_id !== user.id)
                throw new ForbiddenException("Another administrator's first-use continuation cannot be replaced.");
            if (input.goal === "facilities") {
                if (workspace.resume_owner_user_id && workspace.resume_owner_user_id !== user.id)
                    throw new ForbiddenException("Another administrator's first-use continuation cannot be replaced.");
                const source = await resolveFacilitiesContinuation(db, this.identities, user, workspace.school_id, resumePath);
                if (source) {
                    resumePath = source.path;
                    resumeStep = "operating";
                }
                else {
                    if (input.step !== "first_use" || ![facilitiesSetupPath, facilitiesPath].includes(resumePath)) {
                        throw new BadRequestException("Choose your repair or the Repairs workspace.");
                    }
                    const readiness = await readFacilitiesReadiness(db, this.identities, user, workspace.school_id);
                    if (readiness.operation.action === "unavailable")
                        throw new ForbiddenException("Current repair intake or setup access is required.");
                    if (workspace.resume_goal_key === "facilities" && workspace.resume_path && parseFacilitiesContinuation(workspace.resume_path)) {
                        const retained = await resolveFacilitiesContinuation(db, this.identities, user, workspace.school_id, workspace.resume_path);
                        if (retained) {
                            resumePath = retained.path;
                            resumeStep = "operating";
                        }
                    }
                }
            }
            if (workspace.resume_goal_key === "accommodation" && workspace.resume_path && parseAccommodationContinuation(workspace.resume_path)
                && workspace.resume_owner_user_id !== user.id)
                throw new ForbiddenException("Another administrator's first-use continuation cannot be replaced.");
            if (input.goal === "accommodation") {
                if (workspace.resume_owner_user_id && workspace.resume_owner_user_id !== user.id)
                    throw new ForbiddenException("Another administrator's first-use continuation cannot be replaced.");
                const source = await resolveAccommodationContinuation(db, this.identities, user, workspace.school_id, resumePath);
                if (source) {
                    resumePath = source.path;
                    resumeStep = source.source.accepted_at ? "operating" : "first_use";
                }
                else {
                    if (input.step !== "first_use" || ![accommodationSetupPath, accommodationPath].includes(resumePath)) {
                        throw new BadRequestException("Choose your stay or the Accommodation workspace.");
                    }
                    const readiness = await readAccommodationReadiness(db, this.identities, user, workspace.school_id);
                    if (readiness.operation.action === "unavailable")
                        throw new ForbiddenException("Current accommodation responsibility or an exact stay is required.");
                    if (workspace.resume_goal_key === "accommodation" && workspace.resume_path && parseAccommodationContinuation(workspace.resume_path)) {
                        const retained = await resolveAccommodationContinuation(db, this.identities, user, workspace.school_id, workspace.resume_path);
                        if (retained) {
                            resumePath = retained.path;
                            resumeStep = retained.source.accepted_at ? "operating" : "first_use";
                        }
                    }
                }
            }
            if (workspace.resume_goal_key === "dining" && workspace.resume_path && parseDiningContinuation(workspace.resume_path)
                && workspace.resume_owner_user_id !== user.id)
                throw new ForbiddenException("Another administrator's first-use continuation cannot be replaced.");
            if (input.goal === "dining") {
                if (workspace.resume_owner_user_id && workspace.resume_owner_user_id !== user.id)
                    throw new ForbiddenException("Another administrator's first-use continuation cannot be replaced.");
                const source = await resolveDiningContinuation(db, this.identities, user, workspace.school_id, resumePath);
                if (source) {
                    resumePath = source.path;
                    resumeStep = source.source.published_at ? "operating" : "first_use";
                }
                else {
                    if (input.step !== "first_use" || ![diningSetupPath, diningPath].includes(resumePath)) {
                        throw new BadRequestException("Choose your dated menu or the Dining workspace.");
                    }
                    const readiness = await readDiningReadiness(db, this.identities, user, workspace.school_id);
                    if (readiness.operation.action === "unavailable")
                        throw new ForbiddenException("Current dining responsibility is required.");
                    if (workspace.resume_goal_key === "dining" && workspace.resume_path && parseDiningContinuation(workspace.resume_path)) {
                        const retained = await resolveDiningContinuation(db, this.identities, user, workspace.school_id, workspace.resume_path);
                        if (retained) {
                            resumePath = retained.path;
                            resumeStep = retained.source.published_at ? "operating" : "first_use";
                        }
                    }
                }
            }
            const state = (await sql `UPDATE progressive_onboarding_workspaces SET resume_step=${resumeStep},
          resume_goal_key=${input.goal ?? null},resume_path=${resumePath},revision=revision+1,updated_at=now()
        WHERE id=${workspaceId}::uuid RETURNING revision`.execute(db)).rows[0];
            await sql `INSERT INTO progressive_onboarding_audits(workspace_id,actor_id,action,revision,metadata)
        VALUES(${workspaceId}::uuid,${user.id}::uuid,'resume_updated',${state.revision},${JSON.stringify({ ...input, step: resumeStep, path: resumePath })}::jsonb)`.execute(db);
            return workspace.school_id;
        });
        await this.audit.record({ action: "institution.progressive_resume.updated", request, actorId: user.id,
            schoolId, targetType: "school", targetId: schoolId, metadata: { ...input, step: resumeStep, path: resumePath } });
        return this.snapshot({ ...user, active_school_id: schoolId });
    }
    async setProfile(user, body, request) {
        this.requireLivePreferences(request);
        const input = updateProfile.parse(body);
        const requestId = request.requestId;
        const schoolId = await this.db.transaction().execute(async (db) => {
            const workspace = await this.requireAdminWorkspace(user, db);
            const workspaceId = await this.ensureProgressiveRecord(db, user, workspace);
            await sql `UPDATE schools SET name=${input.display_name},timezone=COALESCE(${input.timezone ?? null},timezone)
        WHERE id=${workspace.school_id}::uuid`.execute(db);
            const state = (await sql `UPDATE progressive_onboarding_workspaces SET profile_named=true,
        revision=revision+1,updated_at=now() WHERE id=${workspaceId}::uuid RETURNING revision`.execute(db)).rows[0];
            const event = await db.insertInto("event_outbox").values({
                school_id: workspace.school_id,
                event_type: "institution.profile.updated",
                aggregate_type: "institution",
                aggregate_id: workspace.school_id,
                audience_user_ids: [user.id],
                payload: { refresh: ["institution-profile"], profile_named: true },
                idempotency_key: `progressive-profile:${requestId}:${workspace.school_id}`,
            }).returning("id").executeTakeFirstOrThrow();
            await this.campusModel.recordAcceptedChange(db, {
                school_id: workspace.school_id,
                actor_user_id: user.id,
                command_type: "institution.profile_named",
                target: { domain: "institutions", domain_id: workspace.school_id },
                idempotency_key: `campus-model:${event.id}`,
                correlation_id: requestId,
                causation_id: null,
                expected_revision: null,
                authority_evidence: ["active_institution_administrator"],
                operating_rule_version_ref: null,
                source_domain: "institution_onboarding",
                safe_context: { profile_named: true },
                entities: [{ kind: "institution", domain: "institutions", domain_id: workspace.school_id,
                        label: input.display_name, lifecycle_state: "active", source_revision: state.revision, metadata: {} }],
                relationships: [],
                outcome: { code: "profile_named", explanation: "The private workspace profile was named.",
                    resulting_revision: state.revision, metadata: {} },
                domain_event_id: event.id,
            });
            await sql `INSERT INTO progressive_onboarding_audits(workspace_id,actor_id,action,revision,metadata)
        VALUES(${workspaceId}::uuid,${user.id}::uuid,'profile_named',${state.revision},
          ${JSON.stringify({ timezone: input.timezone ?? null })}::jsonb)`.execute(db);
            return workspace.school_id;
        });
        await this.audit.record({ action: "institution.progressive_profile.named", request, actorId: user.id,
            schoolId, targetType: "school", targetId: schoolId, metadata: { timezone: input.timezone ?? null } });
        return this.snapshot({ ...user, active_school_id: schoolId });
    }
    async submitFormal(user, body, request) {
        if (!user.email_verified_at)
            throw new ConflictException("Verify your account email before requesting organisation verification.");
        const input = formalApplication.parse(body);
        const result = await this.db.transaction().execute(async (db) => {
            const workspace = await this.requireAdminWorkspace({ ...user, active_school_id: input.school_id ?? user.active_school_id ?? null }, db);
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`progressive-verification:${workspace.school_id}`},0))`.execute(db);
            if (workspace.verification_status === "approved") {
                throw new ConflictException("This workspace is already organisation-verified.");
            }
            const workspaceId = await this.ensureProgressiveRecord(db, user, workspace);
            let requestedCode = input.requested_code ?? workspace.code;
            let requestedTimezone = input.timezone ?? workspace.timezone;
            if (input.application_id) {
                const current = (await sql `SELECT status,requested_code,timezone FROM institution_onboarding_applications
          WHERE id=${input.application_id}::uuid AND applicant_user_id=${user.id}::uuid
            AND workspace_school_id=${workspace.school_id}::uuid FOR UPDATE`.execute(db)).rows[0];
                if (!current)
                    throw new NotFoundException("Verification application not found.");
                if (current.status !== "needs_information")
                    throw new ConflictException("Only a verification request awaiting information can be resubmitted.");
                requestedCode = input.requested_code ?? current.requested_code;
                requestedTimezone = input.timezone ?? current.timezone;
                const application = (await sql `UPDATE institution_onboarding_applications SET institution_name=${input.institution_name},
          requested_code=${requestedCode},institution_kind=${input.institution_kind},timezone=${requestedTimezone},state_code=${input.state_code},
          district=${input.district},website=${input.website},applicant_role_title=${input.applicant_role_title},regulator_type=${input.regulator_type},
          regulator_reference=${input.regulator_reference},declaration_accepted=true,status='submitted',review_note='',reviewed_by=NULL,
          reviewed_at=NULL,revision=revision+1,submitted_at=now(),updated_at=now() WHERE id=${input.application_id}::uuid
          RETURNING id,status,workspace_school_id,provisioned_school_id`.execute(db)).rows[0];
                await sql `INSERT INTO institution_onboarding_audits(application_id,actor_id,action,from_status,to_status)
          VALUES(${application.id}::uuid,${user.id}::uuid,'resubmitted','needs_information','submitted')`.execute(db);
                return { application, school_id: workspace.school_id };
            }
            const open = (await sql `SELECT id FROM institution_onboarding_applications
        WHERE workspace_school_id=${workspace.school_id}::uuid AND status IN ('submitted','needs_information')
        LIMIT 1`.execute(db)).rows[0];
            if (open)
                throw new ConflictException("This workspace already has an active verification request.");
            const application = (await sql `INSERT INTO institution_onboarding_applications(
        applicant_user_id,workspace_school_id,institution_name,requested_code,institution_kind,timezone,state_code,district,website,
        applicant_role_title,regulator_type,regulator_reference,declaration_accepted)
        VALUES(${user.id}::uuid,${workspace.school_id}::uuid,${input.institution_name},${requestedCode},${input.institution_kind},${requestedTimezone},
        ${input.state_code},${input.district},${input.website},${input.applicant_role_title},${input.regulator_type},${input.regulator_reference},true)
        RETURNING id,status,workspace_school_id,provisioned_school_id`.execute(db)).rows[0];
            await sql `INSERT INTO institution_onboarding_audits(application_id,actor_id,action,to_status)
        VALUES(${application.id}::uuid,${user.id}::uuid,'submitted','submitted')`.execute(db);
            await sql `UPDATE schools SET verification_status='pending' WHERE id=${workspace.school_id}::uuid`.execute(db);
            await sql `INSERT INTO progressive_onboarding_audits(workspace_id,actor_id,action,revision,metadata)
        SELECT ${workspaceId}::uuid,${user.id}::uuid,'verification_submitted',revision,${JSON.stringify({ application_id: application.id })}::jsonb
        FROM progressive_onboarding_workspaces WHERE id=${workspaceId}::uuid`.execute(db);
            return { application, school_id: workspace.school_id };
        });
        await this.audit.record({ action: input.application_id ? "institution.verification.resubmitted" : "institution.verification.submitted",
            request, actorId: user.id, schoolId: result.school_id, targetType: "institution_onboarding_application",
            targetId: result.application.id, metadata: { institution_kind: input.institution_kind } });
        return result.application;
    }
};
InstitutionOnboardingService = __decorate([
    Injectable(),
    __param(3, Inject(CAMPUS_MODEL_CORE_PORT)),
    __param(4, Optional()),
    __param(4, Inject(HUMAN_AGENT_IDENTITY_PORT)),
    __metadata("design:paramtypes", [DatabaseService, AuditService,
        ProgressiveWorkspaceProvisioner, Object, Object])
], InstitutionOnboardingService);
export { InstitutionOnboardingService };
//# sourceMappingURL=institution-onboarding.service.js.map