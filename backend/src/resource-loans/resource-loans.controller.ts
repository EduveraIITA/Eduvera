import { Controller,Get,Post,Param,Query,Req,HttpCode } from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../common/request.js';
import { ResourceLoansService } from './resource-loans.service.js';
@Controller('api/v1/schools/:schoolId/resources')
export class ResourceLoansController {
 constructor(private readonly resources:ResourceLoansService) {}
 @Get('workspace') workspace(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Query() query:Record<string,string>){return this.resources.workspace(req.authUser,school,query);}
 @Get('options') options(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Query() query:Record<string,string>){return this.resources.options(req.authUser,school,query);}
 @Post('items') createItem(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string){return this.resources.createItem(req.authUser,school,req.body,req);}
 @Post('loans') issue(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string){return this.resources.issue(req.authUser,school,req.body);}
 @Get('loans/:id') detail(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string){return this.resources.detail(req.authUser,school,z.uuid().parse(id));}
 @Get('loans/:id/confirmation') confirmation(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string,@Query('command_id') commandId:string){return this.resources.confirmation(req.authUser,school,z.uuid().parse(id),z.uuid().parse(commandId));}
 @Post('loans/:id/returns') @HttpCode(200) receive(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string){return this.resources.recordReturn(req.authUser,school,z.uuid().parse(id),req.body);}
 @Post('loans/:id/due-date') @HttpCode(200) due(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string){return this.resources.changeDue(req.authUser,school,z.uuid().parse(id),req.body);}
 @Get('loans/:id/custodians') custodians(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string,@Query() query:Record<string,string>){return this.resources.custodianOptions(req.authUser,school,z.uuid().parse(id),query);}
 @Post('loans/:id/responsibility') @HttpCode(200) responsibility(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string){return this.resources.changeCustodian(req.authUser,school,z.uuid().parse(id),req.body);}
 @Post('loans/:id/questions') @HttpCode(200) ask(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string){return this.resources.ask(req.authUser,school,z.uuid().parse(id),req.body);}
 @Post('loans/:id/questions/:question/replies') @HttpCode(200) reply(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string,@Param('question') question:string){return this.resources.answer(req.authUser,school,z.uuid().parse(id),z.uuid().parse(question),req.body);}
 @Post('loans/:id/questions/:question/resolve') @HttpCode(200) resolve(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string,@Param('question') question:string){return this.resources.answer(req.authUser,school,z.uuid().parse(id),z.uuid().parse(question),req.body,true);}
}
