import { Module } from "@nestjs/common";
import { GovernanceModule } from "../governance/governance.module.js";
import { RequestsController } from "./requests.controller.js";
import { RequestsService } from "./requests.service.js";

@Module({ imports: [GovernanceModule], controllers: [RequestsController], providers: [RequestsService], exports: [RequestsService] })
export class RequestsModule {}
