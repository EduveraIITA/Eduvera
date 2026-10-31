var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { DiningService } from "./dining.service.js";
import { DiningAccess } from "./dining.access.js";
import { DiningModel } from "./dining.model.js";
import { DiningController } from "./dining.controller.js";
import { DiningWeeklyService } from "./dining-weekly.service.js";
let DiningModule = class DiningModule {
};
DiningModule = __decorate([
    Module({
        imports: [CampusModelCoreModule],
        controllers: [DiningController],
        providers: [DiningService, DiningAccess, DiningModel, DiningWeeklyService],
        exports: [DiningService],
    })
], DiningModule);
export { DiningModule };
//# sourceMappingURL=dining.module.js.map