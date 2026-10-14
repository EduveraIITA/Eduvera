import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import { config } from '../config.js';
import { sendTransactionalEmail } from '../common/email-transport.js';

@Injectable()
export class MarketingNotificationWorker implements OnModuleInit,OnModuleDestroy {
 private timer?:ReturnType<typeof setInterval>;private busy=false;
 constructor(private readonly db:DatabaseService) {}
 onModuleInit(){this.timer=setInterval(()=>void this.tick(),30000);this.timer.unref();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 async tick(){
  if(this.busy)return;this.busy=true;
  try{
   // A crashed send is unconfirmed; do not risk duplicate mail by retrying it.
   await sql`UPDATE marketing_notification_jobs SET state='unknown',finished_at=now() WHERE state='sending' AND attempted_at<now()-interval '5 minutes'`.execute(this.db);
   await sql`DELETE FROM marketing_rate_limits WHERE expires_at<now()`.execute(this.db);
   await sql`DELETE FROM marketing_enquiries WHERE created_at<now()-interval '12 months'`.execute(this.db);
   const recipient=process.env.MARKETING_NOTIFY_TO;
   if(!config().INVITATION_EMAIL_ENABLED||!recipient||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))return;
   const result=await sql<{id:string;enquiry_id:string}>`UPDATE marketing_notification_jobs SET state='sending',attempted_at=now()
    WHERE id=(SELECT id FROM marketing_notification_jobs WHERE state='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,enquiry_id`.execute(this.db);
   const job=result.rows[0];if(!job)return;
   try{
    await sendTransactionalEmail({to:recipient,senderName:'ThatCampus',subject:'New ThatCampus demo enquiry',text:`A new enquiry is ready for review.\nReference: ${job.enquiry_id}\nOpen the company console: ${config().PUBLIC_URL}/company\nSign in with your company operator account. Form details are available only in the protected console.`});
    await sql`UPDATE marketing_notification_jobs SET state='accepted',finished_at=now() WHERE id=${job.id}::uuid`.execute(this.db);
   }catch{await sql`UPDATE marketing_notification_jobs SET state='unknown',finished_at=now() WHERE id=${job.id}::uuid`.execute(this.db);}
  }catch{ /* Database/provider outages never expose enquiry data to logs. */ }
  finally{this.busy=false;}
 }
}
