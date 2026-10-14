import { Body, Controller, Get, Header, Param, Post, Req } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { CompanyService } from './company.service.js';
import { DatabaseService } from '../database/database.service.js';
import type { AuthenticatedRequest } from '../common/request.js';

@Controller('api/v1/company/enquiries')
export class MarketingController {
 constructor(private readonly company:CompanyService,private readonly db:DatabaseService) {}
 @Get() @Header('Cache-Control','private, no-store')
 async list(@Req() req:AuthenticatedRequest) {
  await this.company.authorize(req.authUser);
  const rows=await sql`SELECT id,full_name,institution_name,institution_type,email,phone,location,student_count,message,status,created_at,
   (SELECT state FROM marketing_notification_jobs j WHERE j.enquiry_id=e.id) AS notification_state
   FROM marketing_enquiries e ORDER BY created_at DESC LIMIT 200`.execute(this.db);
  return {enquiries:rows.rows};
 }
 @Post(':id/status')
 async update(@Req() req:AuthenticatedRequest,@Param('id') id:string,@Body() body:unknown) {
  z.uuid().parse(id);const {status}=z.object({status:z.enum(['new','contacted','closed'])}).strict().parse(body);
  return this.db.transaction().execute(async db=>{
   await this.company.authorize(req.authUser,db);
   const result=await sql`UPDATE marketing_enquiries SET status=${status},reviewed_at=now(),reviewed_by=${req.authUser.id}::uuid WHERE id=${id}::uuid RETURNING id,status`.execute(db);
   await sql`INSERT INTO company_audit(actor_id,action,metadata) VALUES(${req.authUser.id}::uuid,'marketing.enquiry_reviewed',${JSON.stringify({enquiry_id:id,status})}::jsonb)`.execute(db);
   return {enquiry:result.rows[0]??null};
  });
 }
}
