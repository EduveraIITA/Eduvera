var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Global, Module } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";
import { ExecutionDataPlaneRegistry, ExecutionDataPlaneScope, } from "./execution-data-plane.js";
import { EXECUTION_CLOCK_PORT } from "../campus-model-core/execution-clock.port.js";
import { ScopedExecutionClock, SYSTEM_WALL_CLOCK, SystemWallClock, } from "./execution-clock.runtime.js";
let DatabaseModule = class DatabaseModule {
};
DatabaseModule = __decorate([
    Global(),
    Module({
        providers: [
            ExecutionDataPlaneScope,
            ExecutionDataPlaneRegistry,
            DatabaseService,
            SystemWallClock,
            ScopedExecutionClock,
            { provide: SYSTEM_WALL_CLOCK, useExisting: SystemWallClock },
            { provide: EXECUTION_CLOCK_PORT, useExisting: ScopedExecutionClock },
        ],
        exports: [
            DatabaseService,
            ExecutionDataPlaneScope,
            ExecutionDataPlaneRegistry,
            EXECUTION_CLOCK_PORT,
        ],
    })
], DatabaseModule);
export { DatabaseModule };
//# sourceMappingURL=database.module.js.map