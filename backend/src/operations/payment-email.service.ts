import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import type { Database } from '../database/types.js';
import { config } from '../config.js';
import { sendTransactionalEmail } from '../common/email-transport.js';
import { paymentEmail, paymentReceiptPdf, type PaymentDocument } from './payment-receipt.js';

export async function enqueuePaymentEmail(db: DatabaseService | Transaction<Database>, orderId: string, paymentId: string, state: PaymentDocument['state']) {
 await sql`INSERT INTO fee_payment_emails(order_id,provider_payment_id,payment_state) VALUES(${orderId}::uuid,${paymentId},${state}) ON CONFLICT DO NOTHING`.execute(db);
}
export async function readPaymentDocument(db: DatabaseService, orderId: string) {
 return (await sql<Omit<PaymentDocument,'state'> & {state:PaymentDocument['state']|'created';student_id:string;invoice_id:string;email:string;eligible:boolean}>`SELECT s.name AS school,
  concat_ws(' ',su.first_name,su.last_name) AS student, st.admission_number AS admission,i.reference AS invoice,i.description,
  o.amount_paise AS amount,coalesce(o.provider_payment_id,o.last_attempt_id) AS "providerPayment",o.payment_id AS receipt,
  coalesce(p.created_at,o.checked_at) AS date,o.state,st.id AS student_id,i.id AS invoice_id,u.email,
  (u.is_active AND u.email_verified_at IS NOT NULL AND EXISTS(SELECT 1 FROM parents pa JOIN guardian_relationships gr ON gr.guardian_id=pa.id
    JOIN school_memberships m ON m.user_id=pa.user_id AND m.school_id=gr.school_id AND m.role='guardian' AND m.is_active
    WHERE pa.user_id=u.id AND gr.student_id=st.id AND gr.school_id=o.school_id)) AS eligible
  FROM fee_gateway_orders o JOIN fee_invoices i ON i.id=o.invoice_id AND i.school_id=o.school_id JOIN schools s ON s.id=o.school_id
  JOIN students st ON st.id=i.student_id JOIN users su ON su.id=st.user_id JOIN users u ON u.id=o.created_by
  LEFT JOIN fee_payments p ON p.id=o.payment_id WHERE o.id=${orderId}::uuid`.execute(db)).rows[0];
}

@Injectable()
export class PaymentEmailService implements OnModuleInit, OnModuleDestroy {
 private timer?: ReturnType<typeof setInterval>;
 private busy=false;
 private readonly logger=new Logger(PaymentEmailService.name);
 constructor(private readonly db: DatabaseService) {}
 onModuleInit(){this.timer=setInterval(()=>void this.deliverPending(),15_000).unref();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 async deliverPending() {
  if(this.busy || !config().INVITATION_EMAIL_ENABLED) return;
  this.busy=true;
  try {
   // A crash/timeout after SMTP acceptance has an unknown outcome. Never silently resend.
   await sql`UPDATE fee_payment_emails SET delivery_state='unknown',updated_at=now() WHERE delivery_state='sending' AND updated_at<now()-interval '5 minutes'`.execute(this.db);
   for(let n=0;n<10;n++) {
    const job=(await sql<{id:string;order_id:string;provider_payment_id:string;payment_state:PaymentDocument['state']}>`UPDATE fee_payment_emails SET delivery_state='sending',updated_at=now()
     WHERE id=(SELECT id FROM fee_payment_emails WHERE delivery_state='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`.execute(this.db)).rows[0];
    if(!job)break;
    let outcome='unknown';
    try {
     const data=await readPaymentDocument(this.db,job.order_id);
     // Don't send stale failed/pending notices after successful capture, or to revoked/unverified accounts.
     if(!data?.eligible || (['pending','failed'].includes(job.payment_state) && data.state !== 'created')) outcome='skipped';
     else {
      const document={...data,state:job.payment_state,providerPayment:job.provider_payment_id};
      const attachments=job.payment_state==='captured' ? [{filename:`Eduera-test-receipt-${data.receipt}.pdf`,contentType:'application/pdf',content:(await paymentReceiptPdf(document)).toString('base64')}] : [];
      await sendTransactionalEmail({to:data.email,senderName:'Eduera · Pathyakram',...paymentEmail(document,config().PUBLIC_URL!,data.student_id,data.invoice_id),attachments});
      outcome='accepted';
     }
    } catch {this.logger.warn('Payment email acceptance unconfirmed; receipt remains available in the app.');}
    await sql`UPDATE fee_payment_emails SET delivery_state=${outcome},updated_at=now() WHERE id=${job.id}::uuid`.execute(this.db);
   }
  } catch {this.logger.warn('Payment email queue unavailable; queued messages will be checked again.');}
  finally {this.busy=false;}
 }
}
