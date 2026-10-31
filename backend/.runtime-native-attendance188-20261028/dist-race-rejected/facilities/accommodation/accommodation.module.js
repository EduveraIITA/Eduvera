var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../../campus-model-core/campus-model-core.module.js";
import { ResourceLoansModule } from "../../resource-loans/resource-loans.module.js";
import { AccommodationService } from "./accommodation.service.js";
import { AccommodationAccess } from "./accommodation.access.js";
import { AccommodationModel } from "./accommodation.model.js";
import { AccommodationController } from "./accommodation.controller.js";
let AccommodationModule = class AccommodationModule {
};
AccommodationModule = __decorate([
    Module({
        imports: [CampusModelCoreModule, ResourceLoansModule],
        controllers: [AccommodationController],
        providers: [AccommodationService, AccommodationAccess, AccommodationModel],
        exports: [AccommodationService],
    })
], AccommodationModule);
export { AccommodationModule };
//# sourceMappingURL=accommodation.module.js.map