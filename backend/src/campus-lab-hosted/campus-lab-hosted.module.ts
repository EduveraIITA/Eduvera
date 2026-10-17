import { Module } from "@nestjs/common";
import { CampusLabHostedController } from "./campus-lab-hosted.controller.js";
import { CampusLabHostedService } from "./campus-lab-hosted.service.js";

@Module({ controllers: [CampusLabHostedController], providers: [CampusLabHostedService] })
export class CampusLabHostedModule {}
