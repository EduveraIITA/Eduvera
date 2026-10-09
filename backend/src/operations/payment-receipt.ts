import PDFDocument from 'pdfkit';
import { resolve } from 'node:path';
import { invitationLogo } from '../common/invitation-logo.js';

export interface PaymentDocument {
 school: string; student: string; admission: string; invoice: string; description: string;
 amount: number; providerPayment: string; receipt: string | null; date: Date | string;
 state: 'captured' | 'review_required' | 'failed' | 'pending';
}
export const paymentStateText = (state: PaymentDocument['state']) => ({captured:'Payment confirmed',review_required:'Payment needs school review',failed:'Payment attempt failed',pending:'Payment confirmation pending'}[state]);
const money = (amount: number) => `INR ${(amount / 100).toFixed(2)}`;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function paymentEmail(input: PaymentDocument, publicUrl: string, studentId: string, invoiceId: string) {
 const title = paymentStateText(input.state);
 const detail = input.state === 'captured' ? 'Your sandbox payment was verified and recorded. Your PDF test receipt is attached.' : input.state === 'review_required' ? 'The gateway captured the test payment, but the invoice balance changed. Contact the school. Do not pay again. No receipt has been issued.' : input.state === 'failed' ? 'This attempt failed. Check the current invoice status before retrying. No receipt has been issued.' : 'The payment is awaiting capture confirmation. Do not pay again while confirmation is pending. No receipt has been issued.';
 const url = new URL('/parent/fees',publicUrl); url.searchParams.set('student_id',studentId); url.searchParams.set('invoice',invoiceId);
 const rows = [['Institution',input.school],['Student',input.student],['Invoice',input.invoice],['Amount',money(input.amount)],['Payment reference',input.providerPayment]];
 return {subject:`[Test] ${title} - ${input.invoice.replace(/[\r\n]/g,' ')}`, text:`Eduera\n${title}\n\n${detail}\n\n${rows.map(([k,v])=>`${k}: ${v}`).join('\n')}\n\nSandbox only. No real money was collected.\nView payment status: ${url.href}`,
 html:`<!doctype html><html lang="en"><body style="margin:0;background:#f3f6fa;font-family:Arial,sans-serif;color:#172b4d"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:560px;background:#fff;border:1px solid #e1e8f0;border-radius:16px"><tr><td style="padding:28px"><img src="${escape(new URL('/email-assets/eduera-logo-v1.png',publicUrl).href)}" width="48" height="48" alt="Eduera" /><p style="color:#2563eb;font-size:22px;font-weight:bold">Eduera</p><h1 style="font-size:24px">${title}</h1><p style="line-height:1.6">${detail}</p><table width="100%" style="font-size:14px">${rows.map(([k,v])=>`<tr><td style="padding:10px 0;color:#52647a;vertical-align:top">${k}</td><td style="padding:10px 0 10px;text-align:right;overflow-wrap:anywhere">${escape(v!)}</td></tr>`).join('')}</table><p style="padding:14px;background:#edf9f5;border-radius:8px">Test mode - no real money was collected.</p><p style="text-align:center;padding:16px 0"><a href="${escape(url.href)}" style="background:#2563eb;color:#fff;padding:14px 22px;border-radius:8px;text-decoration:none;display:inline-block">View payment status</a></p><p style="font-size:12px;color:#52647a">Sign in to your parent account to view the latest record. Contact your school for payment questions.</p></td></tr></table></td></tr></table></body></html>`};
}
export async function paymentReceiptPdf(input: PaymentDocument): Promise<Buffer> {
 if(input.state !== 'captured' || !input.receipt) throw new Error('A verified, allocated payment is required for a receipt');
 const doc = new PDFDocument({size:'A4',margin:48,info:{Title:'Eduera sandbox payment receipt',Author:'Eduera'}});
 const chunks: Buffer[] = [];
 const result = new Promise<Buffer>((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 doc.font(resolve(process.cwd(),'assets/receipt/DejaVuSans.ttf'));
 doc.image(Buffer.from(invitationLogo.content,'base64'),48,42,{fit:[44,44]});
 doc.fontSize(22).fillColor('#2563eb').text('Eduera',106,49);
 doc.fontSize(10).fillColor('#52647a').text('Your institution. Connected.',106,76);
 doc.moveTo(48,110).lineTo(547,110).strokeColor('#dbe4ee').stroke();
 doc.fontSize(24).fillColor('#172b4d').text('Payment receipt',48,133);
 doc.fontSize(11).fillColor('#2563eb').text('SANDBOX TEST - NO REAL MONEY COLLECTED',48,170);
 doc.fontSize(28).fillColor('#172b4d').text(money(input.amount),48,210);
 doc.fontSize(11).fillColor('#52647a').text('Verified and allocated to the invoice',48,251);
 let y=293;
 const date = new Date(input.date).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})+' IST';
 for(const [label,value] of [['Institution',input.school],['Student',input.student],['Admission number',input.admission],['Invoice',input.invoice],['Fee description',input.description],['Receipt ID',input.receipt],['Payment ID',input.providerPayment],['Recorded on',date],['Method','Razorpay - Test mode']] as Array<[string,string]>) {
   doc.fontSize(10); const height=Math.max(25,doc.heightOfString(value,{width:340})+14);
   if(y+height>730){doc.addPage();y=48;}
   doc.fillColor('#52647a').text(label,48,y,{width:135}); doc.fillColor('#172b4d').text(value,195,y,{width:340});
   y+=height; doc.moveTo(48,y-7).lineTo(547,y-7).strokeColor('#e1e8f0').stroke();
 }
 if(y+60>760){doc.addPage();y=48;}
 doc.fontSize(9).fillColor('#52647a').text('This is a test receipt, not proof of a real payment or bank settlement.\nGenerated electronically by Eduera. No signature is required.',48,y+18,{width:490});
 doc.end(); return result;
}
