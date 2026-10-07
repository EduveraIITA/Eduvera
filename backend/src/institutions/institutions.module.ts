import { Module } from "@nestjs/common";
import { InstitutionsController } from "./institutions.controller.js";
import { InstitutionsService } from "./institutions.service.js";

@Module({ controllers: [InstitutionsController], providers: [InstitutionsService], exports: [InstitutionsService] })
export class InstitutionsModule {}
