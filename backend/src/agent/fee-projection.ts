/** Monetary arithmetic belongs to the application, not the language model.
 * The persisted source remains the original integer-paise ledger for audit and
 * confirmation. This projection is only the model-facing representation. */
const inr=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',currencyDisplay:'code',minimumFractionDigits:2});
function rupees(paise:unknown) {
  return typeof paise==='number'&&Number.isSafeInteger(paise)?inr.format(paise/100):null;
}
function money(value:unknown):unknown {
  if(Array.isArray(value))return value.map(money);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).map(([key,item])=>key.endsWith('_paise')
    ? [key.replace(/_paise$/,'_inr'),rupees(item)] : [key,money(item)]));
}
export function feeModelProjection(value:unknown) {
  const data=value as {invoices?:Array<{balance_paise?:number}>};
  const invoices=Array.isArray(data?.invoices)?data.invoices:[];
  const valid=Array.isArray(data?.invoices)&&invoices.every(row=>Number.isSafeInteger(row.balance_paise));
  const balance=valid?invoices.reduce((total,row)=>total+row.balance_paise!,0):null;
  return {currency:'INR',money_format:'All *_inr fields are already formatted in rupees, not paise.',
    summary:{invoice_count:Array.isArray(data?.invoices)?invoices.length:null,outstanding_inr:rupees(balance)},
    ledger:money(value)};
}
