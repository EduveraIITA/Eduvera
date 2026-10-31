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
import { Inject, Injectable } from "@nestjs/common";
import { ExecutionDataPlaneScope } from "./execution-data-plane.js";
export const SYSTEM_WALL_CLOCK = Symbol("SYSTEM_WALL_CLOCK");
export class ExecutionClockError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ExecutionClockError";
    }
}
let SystemWallClock = class SystemWallClock {
    now() {
        return new Date();
    }
    nowIso() {
        return this.now().toISOString();
    }
};
SystemWallClock = __decorate([
    Injectable()
], SystemWallClock);
export { SystemWallClock };
function assertInstitutionContext(context) {
    if (!context
        || typeof context.institution_id !== "string"
        || context.institution_id.trim() !== context.institution_id
        || context.institution_id.length === 0) {
        throw new ExecutionClockError("invalid_institution", "An authoritative institution identity is required to read institution time.");
    }
    if (typeof context.time_zone !== "string" || context.time_zone.trim() !== context.time_zone) {
        throw new ExecutionClockError("invalid_time_zone", "An authoritative IANA institution timezone is required.");
    }
    try {
        new Intl.DateTimeFormat("en", { timeZone: context.time_zone }).format();
    }
    catch {
        throw new ExecutionClockError("invalid_time_zone", "The institution timezone must be a valid IANA timezone.");
    }
    return context;
}
function readClockInstant(clock) {
    const instant = clock.now();
    if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
        throw new ExecutionClockError("invalid_clock", "The selected execution clock returned an invalid instant.");
    }
    // Callers cannot mutate a Date retained by a virtual-clock implementation.
    return new Date(instant.getTime());
}
function localParts(instant, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(instant);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
        date: `${values.year}-${values.month}-${values.day}`,
        time: `${values.hour}:${values.minute}:${values.second}`,
    };
}
/**
 * Integration adapter between domain time reads and the server-owned request
 * execution scope. No request field is inspected here: Simulation time can only
 * arrive through ExecutionDataPlaneScope after authenticated session resolution.
 */
let ScopedExecutionClock = class ScopedExecutionClock {
    scope;
    wallClock;
    constructor(scope, wallClock) {
        this.scope = scope;
        this.wallClock = wallClock;
    }
    now() {
        return readClockInstant(this.selectedClock());
    }
    nowIso() {
        return this.now().toISOString();
    }
    read(rawContext) {
        const context = assertInstitutionContext(rawContext);
        const environment = this.scope.current();
        if (environment && environment.institution_id !== context.institution_id) {
            throw new ExecutionClockError("invalid_institution", "The institution clock request does not match the server-selected execution environment.");
        }
        const instant = this.now();
        const local = localParts(instant, context.time_zone);
        return Object.freeze({
            environment_kind: environment?.kind ?? "live",
            namespace_id: environment?.namespace_id ?? null,
            institution_id: context.institution_id,
            instant,
            iso_instant: instant.toISOString(),
            time_zone: context.time_zone,
            local_date: local.date,
            local_time: local.time,
        });
    }
    institutionDate(context) {
        return this.read(context).local_date;
    }
    selectedClock() {
        const environment = this.scope.current();
        if (!environment)
            return this.wallClock;
        return environment.kind === "simulation" ? environment.virtual_clock : environment.clock;
    }
};
ScopedExecutionClock = __decorate([
    Injectable(),
    __param(1, Inject(SYSTEM_WALL_CLOCK)),
    __metadata("design:paramtypes", [ExecutionDataPlaneScope, Object])
], ScopedExecutionClock);
export { ScopedExecutionClock };
//# sourceMappingURL=execution-clock.runtime.js.map