var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { CampusModelCoreModule } from '../campus-model-core/campus-model-core.module.js';
import { FacilitiesService } from './facilities.service.js';
import { FacilitiesAccess } from './facilities.access.js';
import { FacilitiesModel } from './facilities.model.js';
import { FacilitiesController } from './facilities.controller.js';
import { FacilitiesArtifactStore } from './facilities-artifacts.js';
let FacilitiesModule = class FacilitiesModule {
};
FacilitiesModule = __decorate([
    Module({ imports: [CampusModelCoreModule], controllers: [FacilitiesController], providers: [FacilitiesService, FacilitiesAccess, FacilitiesModel, FacilitiesArtifactStore], exports: [FacilitiesService] })
], FacilitiesModule);
export { FacilitiesModule };
//# sourceMappingURL=facilities.module.js.map