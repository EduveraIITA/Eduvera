import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/lib/api-client';
import { FeeCheckoutController, type CheckoutContext } from '../src/lib/fee-checkout-controller';
import { feeCheckoutAmount, feeCheckoutAttemptValid, feeCheckoutEligible, feeCheckoutResult, readFeeCheckoutOrder, readFeeCheckoutStatuses, type FeeCheckoutAttempt, type FeeCheckoutOrder, type FeeCheckoutStatus } from '../src/lib/fee-checkout-policy';
const school='11111111-1111-4111-8111-111111111111',student='22222222-2222-4222-8222-222222222222',invoice='33333333-3333-4333-8333-333333333333',orderId='44444444-4444-4444-8444-444444444444',receiptId='55555555-5555-4555-8555-555555555555',other='66666666-6666-4666-8666-666666666666',scopeKey=`actor:${other}|school:${school}|world:live`,signature='a'.repeat(64);
const attempt:FeeCheckoutAttempt={version:1,scopeKey,schoolId:school,studentId:student,invoiceId:invoice,ownerHref:`/areas/fees/account?scope=dependent&student_id=${student}&invoice_id=${invoice}`,amount:2500,mode:'live',phase:'order_unknown'};
const order:FeeCheckoutOrder={id:orderId,key_id:'rzp_test_Example',order_id:'order_testOriginal',amount:2500,currency:'INR',sandbox:true},result={razorpay_order_id:order.order_id,razorpay_payment_id:'pay_testPayment',razorpay_signature:signature};
const status=(state:FeeCheckoutStatus['state']='created'):FeeCheckoutStatus=>({id:orderId,state,amount_paise:2500,payment_id:state==='captured'?receiptId:null,provider_payment_id:state==='created'?null:'pay_testPayment',created_at:'2026-10-29T10:00:00Z',checked_at:'2026-10-29T10:01:00Z',email_status:null});
function fixture(input:{initial?:FeeCheckoutAttempt;sdk?:()=>Promise<unknown>;rows?:()=>unknown;order?:unknown;refresh?:()=>Promise<unknown>;mode?:'live'|'simulation';failStorage?:boolean;orderError?:unknown;prepareError?:Error;afterClear?:()=>void}={}){
 let raw:string|null=input.initial?JSON.stringify(input.initial):null,sdkCalls=0,prepares=0,refreshes=0,alive=true;const calls:{path:string;body?:string}[]=[],writes:string[]=[];
 const controller=new FeeCheckoutController({scopeKey,schoolId:school,mode:input.mode??'live',storage:{read:async()=>raw,write:async value=>{raw=value;writes.push(value);if(input.failStorage)throw new Error('Commit unknown');},clear:async()=>{raw=null;input.afterClear?.();}},request:async(path,options)=>{calls.push({path,body:options?.body});if(path.endsWith('/order/')){if(input.orderError)throw input.orderError;return input.order??order;}if(path.endsWith('/verify/'))return{state:'captured',payment_id:receiptId};if(path.endsWith('/status/'))return input.rows?input.rows():[status('captured')];throw new Error('Unexpected source');}});
 const context:CheckoutContext={assertCurrent(){if(!alive)throw new Error('Original actor/campus/world closed');},preflight:async a=>{assert.equal(a.invoiceId,invoice);},prepareSdk:async()=>{prepares++;if(input.prepareError)throw input.prepareError;return{open:async()=>{sdkCalls++;return input.sdk?input.sdk():result;}};},refresh:async()=>{refreshes++;return input.refresh?.();}};
 return{controller,context,calls,writes,raw:()=>raw,sdkCalls:()=>sdkCalls,prepares:()=>prepares,refreshes:()=>refreshes,leave:()=>{alive=false;}};
}
test('checkout is an exact linked-dependent sandbox capability and decimal amount respects current balance',()=>{
 const eligible={scope:'dependent',studentId:student,invoiceStudentId:student,canSubmit:true,enabled:true,paymentMode:'sandbox',balance:2500,pendingPayment:false};assert.equal(feeCheckoutEligible(eligible),true);for(const change of [{scope:'self'},{scope:'person'},{invoiceStudentId:other},{canSubmit:false},{enabled:false},{paymentMode:'live'},{pendingPayment:true},{balance:99},{chargeState:'cancelled'}])assert.equal(feeCheckoutEligible({...eligible,...change}),false);assert.equal(feeCheckoutAmount('24.99',2500),2499);for(const amount of ['25.01','0.99','1e3','1.001','NaN','-1'])assert.throws(()=>feeCheckoutAmount(amount,2500));
});
test('retained checkout whitelist binds original scope, campus, exact dependent/invoice and stores no callback credentials',()=>{
 assert.equal(feeCheckoutAttemptValid(attempt,scopeKey,school),true);for(const change of [{scopeKey:'another world'},{schoolId:other},{studentId:other},{ownerHref:attempt.ownerHref+'&scope=self'},{ownerHref:attempt.ownerHref.replace(invoice,other)},{razorpay_signature:signature},{token:'credential'},{phase:'verification_unknown'}])assert.equal(feeCheckoutAttemptValid({...attempt,...change},scopeKey,school),false);
 const prepared={...attempt,phase:'checkout_unknown',orderId,providerOrderId:order.order_id};assert.equal(feeCheckoutAttemptValid(prepared,scopeKey,school),true);
});
test('order, signature and status data fail closed; sandbox cannot become live or borrow a Simulation checkout',()=>{
 assert.equal(readFeeCheckoutOrder(order,attempt),order);for(const change of [{key_id:'rzp_live_Example'},{amount:2499},{sandbox:false},{evidence_mode:'simulation'}])assert.throws(()=>readFeeCheckoutOrder({...order,...change},attempt));assert.deepEqual(feeCheckoutResult(result,order),result);assert.throws(()=>feeCheckoutResult({...result,razorpay_order_id:'order_other'},order));assert.throws(()=>feeCheckoutResult({...result,razorpay_signature:'not-a-signature'},order));
 assert.deepEqual(readFeeCheckoutStatuses([status('captured')]),[status('captured')]);for(const row of [{...status('captured'),payment_id:null},{...status('pending'),payment_id:receiptId},{...status(),amount_paise:NaN},{...status(),state:'paid'},{...status(),created_at:'bad'}])assert.throws(()=>readFeeCheckoutStatuses([row]));assert.throws(()=>readFeeCheckoutStatuses([status(),status()]));
});
test('successful SDK callback is followed by owning server verification/status; only captured status releases the journal',async()=>{
 const f=fixture();await f.controller.hydrate();await f.controller.start(attempt,f.context);assert.equal(f.sdkCalls(),1);assert.deepEqual(f.calls.map(c=>c.path.split('/').filter(Boolean).at(-1)),['order','verify','status']);assert.deepEqual(JSON.parse(f.calls[1]!.body!),result);assert.equal(f.raw(),null);assert.equal(f.refreshes(),1);assert.equal(f.controller.snapshot().pending,null);assert.equal(f.controller.snapshot().statusInvoiceId,invoice);assert.equal(f.writes.some(raw=>raw.includes(signature)||raw.includes(order.key_id)),false);
});
test('a success callback and verify response cannot make a pending or foreign current status into a receipt',async()=>{
 const f=fixture({rows:()=>[status('pending')]});await f.controller.hydrate();await f.controller.start(attempt,f.context);assert.equal(f.controller.snapshot().pending?.phase,'verification_unknown');assert.equal(f.refreshes(),0);await f.controller.resume(f.context);assert.equal(f.sdkCalls(),1);assert.match(f.controller.snapshot().error,/Do not open another checkout/);
 const foreign=fixture({rows:()=>[{...status('captured'),id:other}]});await foreign.controller.hydrate();await foreign.controller.start(attempt,foreign.context);assert.ok(foreign.raw());assert.equal(foreign.refreshes(),0);
});
test('cancellation inspects owning status; an explicit retry keeps original amount and exact order',async()=>{
 const f=fixture({sdk:async()=>{throw new Error('User closed checkout');},rows:()=>[status('created')]});await f.controller.hydrate();await f.controller.start(attempt,f.context);assert.equal(f.controller.snapshot().pending?.orderId,orderId);assert.equal(f.calls.some(c=>c.path.endsWith('/verify/')),false);await f.controller.resume(f.context);assert.equal(f.sdkCalls(),2);const posts=f.calls.filter(c=>c.path.endsWith('/order/'));assert.equal(posts.length,2);assert.equal(posts[0]!.body,posts[1]!.body);
 const changed=fixture({initial:{...attempt,phase:'checkout_unknown',orderId,providerOrderId:order.order_id},rows:()=>[status('created')],order:{...order,id:other}});await changed.controller.hydrate();await changed.controller.check(changed.context);await changed.controller.resume(changed.context);assert.equal(changed.sdkCalls(),0);assert.ok(changed.raw());
});
test('captured acceptance with a failed ledger refresh only rechecks status on recovery, never reopens checkout or repeats verify',async()=>{
 let failing=true;const f=fixture({refresh:async()=>{if(failing)throw new Error('Ledger read offline');}});await f.controller.hydrate();await f.controller.start(attempt,f.context);assert.ok(f.raw());failing=false;await f.controller.check(f.context);assert.equal(f.raw(),null);assert.equal(f.sdkCalls(),1);assert.equal(f.calls.filter(c=>c.path.endsWith('/order/')).length,1);assert.equal(f.calls.filter(c=>c.path.endsWith('/verify/')).length,1);
});
test('restored uncertain checkout reads exact order status; it never automatically launches an external SDK',async()=>{
 const f=fixture({initial:{...attempt,phase:'checkout_unknown',orderId,providerOrderId:order.order_id},rows:()=>[status('review_required')]});await f.controller.hydrate();await f.controller.check(f.context);await f.controller.resume(f.context);assert.equal(f.sdkCalls(),0);assert.equal(f.prepares(),0);assert.ok(f.raw());assert.match(f.controller.snapshot().message,/reconcile/);
});
test('Simulation uses ordinary run-local pending-only order API, with no SDK, signature verification, capture or fabricated receipt',async()=>{
 const simulation={...attempt,mode:'simulation' as const},f=fixture({mode:'simulation',order:{...order,key_id:'simulation_no_external_checkout',evidence_mode:'simulation',external_checkout:false,money_moved:false}});await f.controller.hydrate();await f.controller.start(simulation,f.context);assert.equal(f.prepares(),0);assert.equal(f.sdkCalls(),0);assert.equal(f.calls.length,1);assert.equal(f.raw(),null);assert.match(f.controller.snapshot().message,/no payment or receipt was invented/);
 const invalid=fixture({mode:'simulation'});await invalid.controller.hydrate();await invalid.controller.start(simulation,invalid.context);assert.ok(invalid.raw());assert.equal(invalid.sdkCalls(),0);
});
test('scope loss after external callback sends no verification in another account/world, and storage denial sends no order',async()=>{
 let callback:(value:unknown)=>void=()=>{},f=fixture({sdk:()=>new Promise(resolve=>{callback=resolve;})});await f.controller.hydrate();const started=f.controller.start(attempt,f.context);while(!f.sdkCalls())await new Promise(resolve=>setImmediate(resolve));f.leave();callback(result);await started;assert.equal(f.calls.some(c=>c.path.endsWith('/verify/')),false);assert.ok(f.raw());
 const denied=fixture({failStorage:true});await denied.controller.hydrate();await denied.controller.start(attempt,denied.context);assert.equal(denied.calls.length,0);assert.equal(denied.controller.snapshot().blocked,true);assert.ok(denied.raw());
});
test('historical status is bound to its requested invoice for private receipt download',async()=>{
 const f=fixture();await f.controller.hydrate();await f.controller.history(other,f.context);assert.equal(f.controller.snapshot().statusInvoiceId,other);assert.equal(f.calls[0]!.path,`/api/v1/schools/${school}/fees/invoices/${other}/razorpay/status/`);assert.equal(f.sdkCalls(),0);assert.equal(f.raw(),null);
});

test('unavailable native ABI creates no order; fresh definite order refusal can release, a previously unknown refusal cannot',async()=>{
 const missing=fixture({prepareError:new Error('Rebuild installed native ABI')});await missing.controller.hydrate();await missing.controller.start(attempt,missing.context);assert.equal(missing.calls.length,0);assert.equal(missing.raw(),null);
 const definite=fixture({orderError:new ApiError('Amount changed',400)});await definite.controller.hydrate();await definite.controller.start(attempt,definite.context);assert.equal(definite.raw(),null);assert.equal(definite.sdkCalls(),0);
 const uncertain=fixture({initial:attempt,orderError:new ApiError('Access changed',403),rows:()=>[]});await uncertain.controller.hydrate();await uncertain.controller.check(uncertain.context);await uncertain.controller.resume(uncertain.context);assert.ok(uncertain.raw());assert.equal(uncertain.sdkCalls(),0);
});

test('committed checkout cleanup clears shared pending before late focus loss, for capture and definite refusal', async () => {
  let captured: ReturnType<typeof fixture>; captured = fixture({ afterClear: () => captured.leave() });
  await captured.controller.hydrate(); await captured.controller.start(attempt, captured.context);
  assert.equal(captured.raw(), null); assert.equal(captured.controller.snapshot().pending, null);
  assert.equal(captured.sdkCalls(), 1); assert.equal(captured.calls.filter(call => call.path.endsWith('/verify/')).length, 1);
  let refused: ReturnType<typeof fixture>; refused = fixture({ orderError: new ApiError('Amount changed', 400), afterClear: () => refused.leave() });
  await refused.controller.hydrate(); await refused.controller.start(attempt, refused.context);
  assert.equal(refused.raw(), null); assert.equal(refused.controller.snapshot().pending, null); assert.equal(refused.sdkCalls(), 0);
});
