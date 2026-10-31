import { Body, Controller, Get, HttpCode, Module, Param, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/request.js';
import { CampusScenesModule } from '../campus-scenes/campus-scenes.module.js';
import { CampusSceneImportProvider } from './scene-import.provider.js';
import { CampusSceneImportService } from './scene-import.service.js';

@Controller('api/v1/schools/:schoolId/campus-scenes/:campusId/imports')
export class CampusSceneImportController {
  constructor(private readonly importer:CampusSceneImportService) {}
  @Get('capabilities/') capabilities(@Req() request:AuthenticatedRequest,@Param('schoolId') school:string,@Param('campusId') campus:string){return this.importer.capabilities(request.authUser,school,campus);}
  @Post('lookup/') @HttpCode(200) lookup(@Req() request:AuthenticatedRequest,@Param('schoolId') school:string,@Param('campusId') campus:string,@Body() body:unknown){return this.importer.lookup(request.authUser,school,campus,body);}
  @Post('/') @HttpCode(200) import(@Req() request:AuthenticatedRequest,@Param('schoolId') school:string,@Param('campusId') campus:string,@Body() body:unknown){return this.importer.import(request.authUser,school,campus,body);}
}
@Module({imports:[CampusScenesModule],controllers:[CampusSceneImportController],providers:[CampusSceneImportProvider,CampusSceneImportService]})
export class CampusSceneImportModule {}
