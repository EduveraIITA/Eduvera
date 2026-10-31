var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { GovernanceModule } from "../governance/governance.module.js";
import { RequestsController } from "./requests.controller.js";
import { RequestsService } from "./requests.service.js";
import { FinanceArrangementsModule } from "../operations/finance-arrangements.module.js";
let RequestsModule = class RequestsModule {
};
RequestsModule = __decorate([
    Module({ imports: [GovernanceModule, FinanceArrangementsModule], controllers: [RequestsController], providers: [RequestsService], exports: [RequestsService] })
], RequestsModule);
export { RequestsModule };
//# sourceMappingURL=requests.module.js.map