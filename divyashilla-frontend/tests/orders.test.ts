import { expect,it } from 'vitest';
import { createOrderSchema,money,parseOrderFilters,statusSchema,updateOrderSchema } from '../src/modules/orders/validation';
import { closed,nextStatus } from '../src/modules/orders/types';
const uuid='12345678-1234-4123-8123-123456789012';
const base={customer_id:uuid,design_id:uuid,supplier_id:null,order_date:'2026-10-02',expected_delivery_date:null,buying_price:null,selling_price:'5000',advance_amount:'0',additional_work:''};
it('preserves exact money, including the NUMERIC maximum, and permits unknown buying prices',()=>{
  expect(money.parse('999999999999.99')).toBe('999999999999.99');expect(money.parse('1.2')).toBe('1.20');
  expect(createOrderSchema.parse(base)).toMatchObject({selling_price:'5000.00',advance_amount:'0.00',buying_price:null,additional_work:null});
});
it('rejects floating-point/exponent/negative/oversized/malformed money',()=>{
  for(const amount of ['1e3','-1','1.234','1000000000000','NaN','Infinity','01',''])expect(money.safeParse(amount).success).toBe(false);
});
it('validates dates and agreed advance against the selling price',()=>{
  expect(createOrderSchema.safeParse({...base,advance_amount:'5000.01'}).success).toBe(false);
  expect(createOrderSchema.safeParse({...base,expected_delivery_date:'2026-10-01'}).success).toBe(false);
  expect(createOrderSchema.safeParse({...base,order_date:'2026-02-30'}).success).toBe(false);
  expect(createOrderSchema.safeParse({...base,order_date:'0000-01-01'}).success).toBe(false);
});
it('validates UUID links and optional recipient overrides',()=>{
  expect(createOrderSchema.safeParse({...base,customer_id:''}).success).toBe(false);
  expect(createOrderSchema.safeParse({...base,design_id:'invalid'}).success).toBe(false);
  expect(createOrderSchema.safeParse({...base,delivery_phone:'123'}).success).toBe(false);
  const parsed=createOrderSchema.parse({...base,delivery_name:'Recipient',delivery_phone:'+91 (98765) 43210',delivery_city:'Pune',delivery_address:' '});
  expect(parsed.delivery_phone).toBe('+919876543210');expect(parsed.delivery_address).toBe(null);
});
it('does not allow client order numbers, snapshot spoofing or calculated money',()=>{
  for(const field of ['order_number','order_status','profit','balance_amount','design_name_snapshot','customer_net_received','created_by'])
    expect(createOrderSchema.safeParse({...base,[field]:'spoofed'}).success).toBe(false);
});
it('requires a version and actual changed fields in PATCH',()=>{
  expect(updateOrderSchema.safeParse({version:1}).success).toBe(false);
  expect(updateOrderSchema.safeParse({selling_price:'5'}).success).toBe(false);
  expect(updateOrderSchema.safeParse({version:0,selling_price:'5'}).success).toBe(false);
  expect(updateOrderSchema.parse({version:7,selling_price:'5'})).toEqual({version:7,selling_price:'5.00'});
});
it('validates search, exact BIGINT numbers, filter dates, enums and pagination',()=>{
  expect(parseOrderFilters(new URLSearchParams('q=Pune&order_number=9223372036854775807&limit=10&page=2')).success).toBe(true);
  for(const query of ['order_number=9223372036854775808','order_number=0','order_status=Ready','page=0','limit=101','customer_id=bad','city=Pune','date_from=2026-10-03&date_to=2026-10-02','page=1&page=2'])
    expect(parseOrderFilters(new URLSearchParams(query)).success).toBe(false);
});
it('follows forward transitions, treats delivered/cancelled as terminal, and requires status reasons',()=>{
  expect(nextStatus('NEW')).toBe('IN_WORK');expect(nextStatus('IN_WORK')).toBe('READY_FOR_DELIVERY');expect(nextStatus('READY_FOR_DELIVERY')).toBe('DELIVERED');
  expect(nextStatus('DELIVERED')).toBe(null);expect(nextStatus('CANCELLED')).toBe(null);expect(closed('CANCELLED')).toBe(true);expect(closed('NEW')).toBe(false);
  expect(statusSchema.safeParse({version:1,order_status:'IN_WORK',reason:' '}).success).toBe(false);
});

it('malformed order numbers fail validation without throwing',()=>{expect(()=>parseOrderFilters(new URLSearchParams('order_number=bad'))).not.toThrow();expect(parseOrderFilters(new URLSearchParams('order_number=bad')).success).toBe(false);});
