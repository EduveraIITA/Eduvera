declare module 'react-native-razorpay' {
 const RazorpayCheckout:{open(options:{key:string;order_id:string;amount:number;currency:string;name:string;description:string;allow_rotation?:boolean;modal?:{confirm_close?:boolean}}):Promise<unknown>};
 export default RazorpayCheckout;
}
