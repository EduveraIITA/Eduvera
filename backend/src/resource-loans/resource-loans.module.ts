import { Module } from '@nestjs/common';
import { CampusModelCoreModule } from '../campus-model-core/campus-model-core.module.js';
import { InstitutionSetupModule } from '../institution-setup/institution-setup.module.js';
import { ResourceLoansService } from './resource-loans.service.js';
import { ResourceLoansModel } from './resource-loans.model.js';
import { ResourceLoansAccess } from './resource-loans.access.js';
import { ResourceLoansController } from './resource-loans.controller.js';
@Module({imports:[CampusModelCoreModule,InstitutionSetupModule],controllers:[ResourceLoansController],providers:[ResourceLoansService,ResourceLoansAccess,ResourceLoansModel],exports:[ResourceLoansService]})
export class ResourceLoansModule {}
