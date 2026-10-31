import { NativeModules, TurboModuleRegistry } from 'react-native';
import type { FeeCheckoutOrder } from './fee-checkout-policy';
export interface FeeCheckoutSdk { open(order:FeeCheckoutOrder):Promise<unknown> }
/** Loaded only for a deliberate Live-world sandbox checkout, before creating an order. */
export async function prepareFeeCheckoutSdk():Promise<FeeCheckoutSdk>{
 const checkout=(TurboModuleRegistry.get('RNRazorpayCheckout')??NativeModules.RNRazorpayCheckout) as {open?:unknown}|null,event=(TurboModuleRegistry.get('RazorpayEventEmitter')??NativeModules.RazorpayEventEmitter) as {addListener?:unknown}|null;
 if(typeof checkout?.open!=='function'||typeof event?.addListener!=='function')throw new Error('This installed app needs its Razorpay native module rebuilt before sandbox checkout is available. No order was created.');
 const sdk=(await import('react-native-razorpay')).default;
 return{open:order=>sdk.open({key:order.key_id,order_id:order.order_id,amount:order.amount,currency:order.currency,name:'ThatCampus',description:'Campus fee · Sandbox test',allow_rotation:true,modal:{confirm_close:true}})};
}
