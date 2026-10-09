import { expect, it } from 'vitest';
import { paymentEmail, paymentReceiptPdf, type PaymentDocument } from '../src/operations/payment-receipt.js';
const sample:PaymentDocument={school:'Cambridge International School',student:'Aarav Sharma',admission:'CIS-001',invoice:'TERM-2026-001',description:'Term tuition',amount:250000,providerPayment:'pay_test123',receipt:'test-receipt-123',date:'2026-10-09T12:00:00Z',state:'captured'};
it('creates an actual PDF only for allocated captured payments',async()=>{
 const pdf=await paymentReceiptPdf(sample);expect(pdf.subarray(0,5).toString()).toBe('%PDF-');expect(pdf.length).toBeGreaterThan(2000);
 for(const state of ['pending','failed','review_required'] as const)await expect(paymentReceiptPdf({...sample,state})).rejects.toThrow(/verified/);
 await expect(paymentReceiptPdf({...sample,receipt:null})).rejects.toThrow(/verified/);
});
it('escapes supplied values and uses a sign-in protected link without email or secrets',()=>{
 const email=paymentEmail({...sample,school:'<script>alert(1)</script>'},'https://school.example','student-id','invoice-id');
 expect(email.html).toContain('&lt;script&gt;');expect(email.html).not.toContain('<script>');expect(email.html).toContain('student_id=student-id');expect(email.html).toContain('invoice=invoice-id');
 expect(email.subject).toContain('[Test]');expect(email.text).toContain('No real money');expect(email.html).toContain('https://school.example/email-assets/eduera-logo-v1.png');expect(email).not.toHaveProperty('inlineImages');
});
it('never claims a receipt for failed, pending or unallocated payments',()=>{
 for(const state of ['pending','failed','review_required'] as const){const email=paymentEmail({...sample,state,receipt:null},'https://school.example','student','invoice');expect(email.text).toContain('No receipt has been issued');}
});
