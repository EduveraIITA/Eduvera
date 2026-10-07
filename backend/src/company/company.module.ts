import { InstitutionsModule } from '../institutions/institutions.module.js';
import { Module } from '@nestjs/common';
import { CompanyController } from './company.controller.js';
import { CompanyService } from './company.service.js';
@Module({imports:[InstitutionsModule],controllers:[CompanyController],providers:[CompanyService]})
export class CompanyModule {}
