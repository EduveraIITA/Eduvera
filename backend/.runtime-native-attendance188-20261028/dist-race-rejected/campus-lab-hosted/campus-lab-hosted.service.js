var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { config } from "../config.js";
import { DatabaseService } from "../database/database.service.js";
import { CampusLabSimulationEnvironmentService } from "../database/campus-lab-simulation-environment.service.js";
import { AuthService } from "../auth/auth.service.js";
let CampusLabHostedService = class CampusLabHostedService {
    db;
    environments;
    auth;
    constructor(db, environments, auth) {
        this.db = db;
        this.environments = environments;
        this.auth = auth;
    }
    async assertCambridgeMember(request, requireAdmin = false) {
        const settings = config();
        const available = settings.DEPLOYMENT_ENVIRONMENT === "development"
            || (settings.HOSTED_CAMPUS_SIMULATOR_ENABLED && settings.DEPLOYMENT_ENVIRONMENT === "stage");
        if (!available)
            throw new NotFoundException();
        const schoolId = request.authUser.active_school_id;
        if (!schoolId)
            throw new ForbiddenException("Select the Cambridge testing campus first.");
        const membership = await this.db.selectFrom("school_memberships as m")
            .innerJoin("schools as s", "s.id", "m.school_id")
            .select("m.id")
            .where("m.user_id", "=", request.authUser.id)
            .where("m.school_id", "=", schoolId)
            .where("m.is_active", "=", true)
            .where("s.code", "=", "cis")
            .$if(requireAdmin, (query) => query.where("m.role", "=", "admin"))
            .executeTakeFirst();
        if (!membership)
            throw new ForbiddenException(requireAdmin
                ? "Campus Lab controls are available only to Cambridge test-campus administrators."
                : "Campus Lab is available only to Cambridge test-campus members.");
        return schoolId;
    }
    async controlState(schoolId) {
        const record = await this.db.selectFrom("hosted_campus_lab_controls")
            .select(["enabled", "clock_mode"])
            .where("school_id", "=", schoolId)
            .executeTakeFirst();
        return { enabled: record?.enabled ?? false, clock_mode: record?.clock_mode ?? "60m" };
    }
    async saveControl(schoolId, enabled, clockMode, changedBy) {
        await this.db.insertInto("hosted_campus_lab_controls").values({
            school_id: schoolId, enabled, clock_mode: clockMode, changed_by: changedBy, changed_at: new Date(),
        }).onConflict((conflict) => conflict.column("school_id").doUpdateSet({
            enabled, clock_mode: clockMode, changed_by: changedBy, changed_at: new Date(),
        })).execute();
    }
    async forward(path, init = {}) {
        const settings = config();
        const simulatorOrigin = settings.DEPLOYMENT_ENVIRONMENT === "development"
            ? "http://127.0.0.1:8002"
            : settings.HOSTED_CAMPUS_SIMULATOR_URL;
        const response = await fetch(`${simulatorOrigin}/${path}`, {
            ...init,
            headers: {
                accept: "application/json",
                "x-campus-lab-key": settings.CAMPUS_LAB_PROXY_KEY,
                ...(init.headers ?? {}),
            },
            signal: AbortSignal.timeout(8_000),
        }).catch(() => null);
        if (!response)
            throw new ServiceUnavailableException("The Cambridge testing simulation is unavailable.");
        const body = await response.json().catch(() => ({ error: "The Cambridge testing simulation returned an invalid response." }));
        const detail = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : null;
        if (!response.ok)
            throw new ServiceUnavailableException(detail ?? "The Cambridge testing simulation is unavailable.");
        return body;
    }
    async status(request) {
        await this.assertCambridgeMember(request);
        // Status polling is observational. Replaying the persisted control record here
        // turned every UI refresh into an activation command; an enabled environment
        // then failed because only the original activation owns the isolated run_id.
        // Process recovery must use an explicit, run-aware reconciliation path rather
        // than making a read endpoint mutate the Simulation environment.
        return this.forward("status");
    }
    async control(request) {
        const schoolId = await this.assertCambridgeMember(request, true);
        const body = request.body;
        if (typeof body?.enabled !== "boolean" || Object.keys(body).some((key) => !["enabled", "clock_mode"].includes(key))) {
            throw new ForbiddenException("Campus Lab control requires enabled and may include clock_mode.");
        }
        const enabled = body.enabled;
        const current = await this.controlState(schoolId);
        const clockMode = body.clock_mode === undefined ? current.clock_mode : body.clock_mode;
        if (typeof clockMode !== "string" || !["realtime", "1m", "15m", "60m"].includes(clockMode)) {
            throw new ForbiddenException("Campus Lab clock mode must be realtime, 1m, 15m or 60m.");
        }
        let runId = null;
        // Campus Lab rehearses the synthetic fixture from its own harness boundary.
        // It must never bind a normal product session to the harness-only run.
        await this.auth.returnSessionToLive(request.sessionHash);
        if (enabled) {
            const school = await this.db.selectFrom("schools").select("timezone").where("id", "=", schoolId).executeTakeFirst();
            const run = await this.environments.prepare(schoolId, school?.timezone ?? "Asia/Kolkata");
            runId = run.run_id;
        }
        const selectedClock = clockMode;
        await this.saveControl(schoolId, enabled, selectedClock, request.authUser.id);
        try {
            const result = await this.forward("control", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ enabled, clock_mode: selectedClock, ...(runId ? { run_id: runId } : {}) }),
            });
            if (!enabled)
                await this.environments.discard();
            return result;
        }
        catch (error) {
            if (enabled) {
                await this.environments.discard();
                await this.saveControl(schoolId, false, selectedClock, request.authUser.id);
                throw error;
            }
            // A stopped actor process cannot be allowed to strand the product in its
            // fork. Return to Live and discard remain successful even if its status
            // service is already unavailable.
            await this.environments.discard();
            return { status: "paused", control: { enabled: false, clock_mode: selectedClock } };
        }
    }
};
CampusLabHostedService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService,
        CampusLabSimulationEnvironmentService,
        AuthService])
], CampusLabHostedService);
export { CampusLabHostedService };
//# sourceMappingURL=campus-lab-hosted.service.js.map