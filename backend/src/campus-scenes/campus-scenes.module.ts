import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import {
  CampusSceneDirectoryController,
  CampusScenesController,
} from "./campus-scenes.controller.js";
import { CampusScenesModel } from "./campus-scenes.model.js";
import { CampusScenesService } from "./campus-scenes.service.js";
import { InstitutionSetupModule } from "../institution-setup/institution-setup.module.js";

@Module({
  imports: [CampusModelCoreModule, InstitutionSetupModule],
  controllers: [CampusSceneDirectoryController, CampusScenesController],
  providers: [CampusScenesModel, CampusScenesService],
  exports: [CampusScenesService],
})
export class CampusScenesModule {}
