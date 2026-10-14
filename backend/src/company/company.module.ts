import { MarketingController } from './marketing.controller.js';
import { MarketingNotificationWorker } from './marketing.worker.js';
import { InstitutionsModule } from '../institutions/institutions.module.js';
import { Module } from '@nestjs/common';
import { CompanyController } from './company.controller.js';
import { CompanyService } from './company.service.js';
@Module({imports:[InstitutionsModule],controllers:[CompanyController,MarketingController],providers:[CompanyService,MarketingNotificationWorker]})
export class CompanyModule {}
