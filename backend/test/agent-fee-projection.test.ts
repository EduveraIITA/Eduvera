import {describe,it,expect} from 'vitest';
import {feeModelProjection} from '../src/agent/fee-projection.js';
describe('model-facing fee amounts',()=>{
  it('converts minor units once, computes balances, and leaves source evidence unchanged',()=>{
    const source={invoices:[{id:'a',balance_paise:250000,amount_paise:250000},{id:'b',balance_paise:600000},{id:'c',balance_paise:300000}],payments:[{amount_paise:100001}]};
    const result=feeModelProjection(source);
    expect(result.summary).toEqual({invoice_count:3,outstanding_inr:'INR 11,500.00'});
    expect(result.ledger).toMatchObject({invoices:[{id:'a',balance_inr:'INR 2,500.00',amount_inr:'INR 2,500.00'},{id:'b',balance_inr:'INR 6,000.00'},{id:'c',balance_inr:'INR 3,000.00'}],payments:[{amount_inr:'INR 1,000.01'}]});
    expect(source.invoices[0]?.balance_paise).toBe(250000);
    expect(JSON.stringify(result)).not.toContain('balance_paise');
  });
  it('never presents missing or invalid amounts as zero',()=>{
    expect(feeModelProjection({}).summary).toEqual({invoice_count:null,outstanding_inr:null});
    expect(feeModelProjection({invoices:[{}]}).summary.outstanding_inr).toBeNull();
    expect(feeModelProjection({invoices:[{balance_paise:1.5}]}).summary.outstanding_inr).toBeNull();
    expect(feeModelProjection({invoices:[]}).summary.outstanding_inr).toBe('INR 0.00');
  });
});
