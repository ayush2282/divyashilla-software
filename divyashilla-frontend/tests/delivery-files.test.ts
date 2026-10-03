import { expect,it } from 'vitest';
import { assignmentSchema,completeSchema,driverSchema,issueSchema,parseDeliveryFilters } from '../src/modules/delivery/validation';
import { canUpdate,type Delivery } from '../src/modules/delivery/types';
import { MAX_FILE_BYTES,selectedMime,validateFile,validFileOwner } from '../src/modules/files/validation';
const id='12345678-1234-4123-8123-123456789012';
it('delivery drivers validate contacts, names, optional bus and strict safe payloads',()=>{
  expect(driverSchema.parse({version:4,driver_number:'+91 (98765) 43210',driver_or_bus_name:'Pune bus',bus_number:''})).toEqual({version:4,driver_number:'+919876543210',driver_or_bus_name:'Pune bus',bus_number:null});
  for(const extra of [{driver_number:'1'},{driver_or_bus_name:''},{bus_number:'x\ny'},{version:0},{profit:'10'},{selling_price:'5'}])expect(driverSchema.safeParse({version:4,driver_number:'9876543210',driver_or_bus_name:'Bus',bus_number:null,...extra}).success).toBe(false);
});
it('assignment/issue/complete schemas require versions and reasoned assignments',()=>{
  expect(assignmentSchema.safeParse({version:1,assigned_delivery_user_id:id,reason:'Duty'}).success).toBe(true);
  expect(assignmentSchema.safeParse({version:1,assigned_delivery_user_id:id,reason:''}).success).toBe(false);
  expect(issueSchema.safeParse({version:1,reason:' '}).success).toBe(false);
  expect(completeSchema.safeParse({version:1,delivered_at:'2026-10-02'}).success).toBe(false);
});
it('delivery filters reject another assignment for DELIVERY, invalid dates, duplicates and financial filters',()=>{
  expect(parseDeliveryFilters(new URLSearchParams('assigned_delivery_user_id='+id),true).success).toBe(true);
  for(const q of ['assigned_delivery_user_id='+id,'expected_from=2026-10-03&expected_to=2026-10-01','page=0','delivery_status=ready','q=x&q=y','profit=1'])expect(parseDeliveryFilters(new URLSearchParams(q),false).success).toBe(false);
});
it('delivery controls close completed/draft records and permit only pending ready orders',()=>{
  expect(canUpdate({order_status:'READY_FOR_DELIVERY',delivery_status:'SENT'} as Delivery)).toBe(true);
  expect(canUpdate({order_status:'DELIVERED',delivery_status:'DELIVERED'} as Delivery)).toBe(false);
  expect(canUpdate({order_status:'NEW',delivery_status:'NOT_ASSIGNED'} as Delivery)).toBe(false);
});
it('file size cap is inclusive and images/document categories validate MIME and extension',()=>{
  expect(validateFile({name:'photo.png',type:'image/png',size:MAX_FILE_BYTES},'ORDER_PRODUCT_IMAGE')).toBe(null);
  expect(validateFile({name:'photo.png',type:'image/png',size:MAX_FILE_BYTES+1},'ORDER_PRODUCT_IMAGE')).toContain('10 MiB');
  expect(validateFile({name:'blank.png',type:'image/png',size:0},'ORDER_PRODUCT_IMAGE')).toContain('empty');
  expect(validateFile({name:'paper.pdf',type:'application/pdf',size:10},'DESIGN_IMAGE')).toContain('requires');
  expect(validateFile({name:'paper.pdf',type:'application/pdf',size:10},'CUSTOMER_PAYMENT_DOCUMENT')).toBe(null);
  expect(validateFile({name:'photo.jpg',type:'image/png',size:10},'ORDER_PRODUCT_IMAGE')).toContain('extension');
  expect(validateFile({name:'picture.svg',type:'image/svg+xml',size:10},'ORDER_PRODUCT_IMAGE')).toContain('only');
});
it('filenames and owners are safe, Unicode is supported and DELIVERY has only order uploads',()=>{
  expect(selectedMime({name:'मराठी.png',type:''})).toBe('image/png');
  for(const name of ['../p.png','p\\p.png','bad\n.png','x'.repeat(201)+'.png'])expect(validateFile({name,type:'image/png',size:20},'DESIGN_IMAGE')).not.toBe(null);
  expect(validFileOwner({order_id:id},'ORDER_DOCUMENT',false)).toBe(true);
  expect(validFileOwner({design_id:id},'DESIGN_IMAGE',false)).toBe(false);
  expect(validFileOwner({expense_id:id},'EXPENSE_DOCUMENT',true)).toBe(true);
  expect(validFileOwner({order_id:id},'EXPENSE_DOCUMENT',true)).toBe(false);
});
