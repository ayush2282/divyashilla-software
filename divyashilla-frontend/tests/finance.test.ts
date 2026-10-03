import { expect,it } from 'vitest';
import { allocationSchema,cents,customerPaymentSchema,decimal,expenseSchema,parseLedgerFilters,positiveMoney,supplierPaymentSchema,voidSchema } from '../src/modules/finance/validation';
const id='12345678-1234-4123-8123-123456789012',second='22345678-1234-4123-8123-123456789012';
const payment={amount:'500.50',payment_date:'2026-10-02',payment_method:'UPI',note:''};
it('requires exact positive money and handles aggregate decimals without floating-point arithmetic',()=>{
  for(const value of ['0','-1','1e2','1.001','01','1000000000000','bad',''])expect(positiveMoney.safeParse(value).success).toBe(false);
  expect(positiveMoney.parse('999999999999.99')).toBe('999999999999.99');expect(decimal(cents('0.10')+cents('0.20'))).toBe('0.30');expect(decimal(-1n)).toBe('-0.01');
});
it('receipt requires purpose while refund omits it; actor/status spoofing fails',()=>{
  expect(customerPaymentSchema.parse({...payment,order_id:id,direction:'RECEIPT',purpose:'ADVANCE'}).note).toBe(null);
  expect(customerPaymentSchema.safeParse({...payment,order_id:id,direction:'RECEIPT'}).success).toBe(false);
  expect(customerPaymentSchema.safeParse({...payment,order_id:id,direction:'REFUND'}).success).toBe(true);
  for(const extra of [{purpose:'ADVANCE'},{received_by:id},{status:'POSTED'}])expect(customerPaymentSchema.safeParse({...payment,order_id:id,direction:'REFUND',...extra}).success).toBe(false);
});
it('supplier allocations reject duplicate orders, excess amounts and invalid links',()=>{
  const base={...payment,supplier_id:id,direction:'PAYMENT'};
  expect(supplierPaymentSchema.safeParse({...base,allocations:[]}).success).toBe(true);
  expect(supplierPaymentSchema.safeParse({...base,allocations:[{order_id:id,amount:'500.51'}]}).success).toBe(false);
  expect(supplierPaymentSchema.safeParse({...base,allocations:[{order_id:id,amount:'200'},{order_id:id,amount:'200'}]}).success).toBe(false);
  expect(supplierPaymentSchema.safeParse({...base,allocations:[{order_id:id,amount:'200'},{order_id:second,amount:'300.50'}]}).success).toBe(true);
  expect(allocationSchema.safeParse({allocations:[]}).success).toBe(false);
});
it('dates, notes, categories and required void reasons are validated',()=>{
  expect(customerPaymentSchema.safeParse({...payment,payment_date:'2026-02-30',order_id:id,direction:'REFUND'}).success).toBe(false);
  expect(expenseSchema.safeParse({amount:'3',expense_date:'2026-10-02',order_id:id,category:'OTHER',note:'x'.repeat(2001)}).success).toBe(false);
  expect(expenseSchema.safeParse({amount:'3',expense_date:'2026-10-02',order_id:id,category:'DELIVERY',note:''}).success).toBe(true);
  expect(voidSchema.safeParse({reason:' '}).success).toBe(false);expect(voidSchema.parse({reason:'Correction'})).toEqual({reason:'Correction'});
});
it('financial filters are strict, role-independent schemas with module-specific fields and valid ranges',()=>{
  expect(parseLedgerFilters('supplier-payments',new URLSearchParams('supplier_id='+id+'&order_id='+second+'&status=all&direction=REFUND&limit=10')).success).toBe(true);
  for(const query of ['supplier_id='+id,'category=OTHER','date_from=2026-10-03&date_to=2026-10-01','status=DELETED','page=0','limit=101','page=1&page=2'])expect(parseLedgerFilters('customer-payments',new URLSearchParams(query)).success).toBe(false);
  expect(parseLedgerFilters('order-expenses',new URLSearchParams('category=DELIVERY&status=VOID')).success).toBe(true);
});
