export interface RazorpayResult { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
interface Options {
  key: string; order_id: string; amount: number; currency: string; name: string; description: string;
  handler: (result: RazorpayResult) => void;
  modal: { ondismiss: () => void };
  theme: { color: string };
}
interface Checkout { open(): void; on(event: "payment.failed", callback: () => void): void }
declare global { interface Window { Razorpay?: new (options: Options) => Checkout } }
let loading: Promise<void> | undefined;
export function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(() => fail(), 15000);
    const fail = () => { window.clearTimeout(timer); script.remove(); loading = undefined; reject(new Error("Unable to load Razorpay. Check your connection and try again.")); };
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => { window.clearTimeout(timer); if (window.Razorpay) resolve(); else fail(); };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return loading;
}
