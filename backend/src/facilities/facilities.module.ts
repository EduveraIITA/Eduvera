import { Module } from '@nestjs/common';
import { CampusModelCoreModule } from '../campus-model-core/campus-model-core.module.js';
import { FacilitiesService } from './facilities.service.js';
import { FacilitiesAccess } from './facilities.access.js';
import { FacilitiesModel } from './facilities.model.js';
import { FacilitiesController } from './facilities.controller.js';
import { FacilitiesArtifactStore } from './facilities-artifacts.js';
@Module({imports:[CampusModelCoreModule],controllers:[FacilitiesController],providers:[FacilitiesService,FacilitiesAccess,FacilitiesModel,FacilitiesArtifactStore],exports:[FacilitiesService]})
export class FacilitiesModule {}
