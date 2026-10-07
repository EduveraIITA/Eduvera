import { Module } from "@nestjs/common";
import { RestrictedCareController } from "./restricted-care.controller.js";
import { RestrictedCareService } from "./restricted-care.service.js";

@Module({ controllers: [RestrictedCareController], providers: [RestrictedCareService] })
export class RestrictedCareModule {}
