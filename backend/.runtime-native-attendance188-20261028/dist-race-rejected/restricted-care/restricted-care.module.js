var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { RestrictedCareController } from "./restricted-care.controller.js";
import { RestrictedCareService } from "./restricted-care.service.js";
import { RestrictedCareModel } from "./restricted-care.model.js";
let RestrictedCareModule = class RestrictedCareModule {
};
RestrictedCareModule = __decorate([
    Module({ imports: [CampusModelCoreModule], controllers: [RestrictedCareController], providers: [RestrictedCareService, RestrictedCareModel], exports: [RestrictedCareService] })
], RestrictedCareModule);
export { RestrictedCareModule };
//# sourceMappingURL=restricted-care.module.js.map