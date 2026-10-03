import { describe,expect,it } from 'vitest';
import { validateList,validateMaster,reasonSchema } from '../src/modules/masters/validation';
import { loginSchema,passwordSchema } from '../src/auth/validation';
import { dateRangeSchema } from '../src/modules/dashboard/validation';
import { rupees } from '../src/modules/dashboard/format';
const customer={name:'मराठी ग्राहक',phone:'+91 (98765) 43210',city:' Pune ',address:' ',notes:'Line 1\nLine 2'};
describe('frontend contracts',()=>{
  it('normalizes contacts, blank optional text and Unicode without losing notes',()=>{
    const result=validateMaster('customers',customer);expect(result.success).toBe(true);
    if(result.success) expect(result.data).toMatchObject({name:'मराठी ग्राहक',phone:'+919876543210',city:'Pune',address:null,notes:'Line 1\nLine 2'});
  });
  it('requires customer city but permits an empty supplier city',()=>{
    expect(validateMaster('customers',{...customer,city:''}).success).toBe(false);
    const result=validateMaster('suppliers',{...customer,city:''});expect(result.success).toBe(true);
    if(result.success) expect(result.data).toMatchObject({city:null});
  });
  it('rejects invalid phones, oversize text, control characters and actor spoofing',()=>{
    for(const input of [{...customer,phone:'123'},{...customer,name:'x'.repeat(121)},{...customer,city:'bad\ncity'},
      {...customer,notes:'bad\u0000note'},{...customer,created_by:'spoofed'}]) expect(validateMaster('customers',input).success).toBe(false);
  });
  it('keeps exact design size text and does not accept public images/financial fields',()=>{
    const design={design_number:'701',design_name:'Tulsi',size:'3.15 feet',material:'Black stone',notes:''};
    const result=validateMaster('designs',design);expect(result.success).toBe(true);
    if(result.success) expect(result.data).toMatchObject({size:'3.15 feet',notes:null});
    expect(validateMaster('designs',{...design,image_url:'https://example.com/image.png'}).success).toBe(false);
    expect(validateMaster('designs',{...design,buying_price:'1'}).success).toBe(false);
  });
  it('validates filters, phone normalization, page limits, enums and duplicate keys',()=>{
    expect(validateList('customers',new URLSearchParams('page=2&limit=10&status=all&city=Pune')).success).toBe(true);
    for(const query of ['page=0','limit=101','status=POSTED','sort_by=profit','phone=abc','page=1&page=2','city=','unknown=1'])
      expect(validateList('customers',new URLSearchParams(query)).success).toBe(false);
    expect(validateList('designs',new URLSearchParams('material=Stone&size=3.15+feet')).success).toBe(true);
  });
  it('requires a useful activity reason',()=>{expect(reasonSchema.safeParse(' ').success).toBe(false);expect(reasonSchema.safeParse('No longer used').success).toBe(true);});
  it('normalizes usernames and validates password confirmation and length',()=>{
    expect(loginSchema.parse({username:' AYUSH ',password:'a'}).username).toBe('ayush');
    expect(loginSchema.safeParse({username:'x',password:''}).success).toBe(false);
    expect(passwordSchema.safeParse({currentPassword:'old',newPassword:'short',confirmPassword:'short'}).success).toBe(false);
    expect(passwordSchema.safeParse({currentPassword:'old',newPassword:'New-password-123',confirmPassword:'Mismatch-123'}).success).toBe(false);
  });
  it('rejects impossible dates, year zero and reversed date ranges',()=>{
    expect(dateRangeSchema.safeParse({date_from:'2026-02-30'}).success).toBe(false);
    expect(dateRangeSchema.safeParse({date_from:'0000-01-01'}).success).toBe(false);
    expect(dateRangeSchema.safeParse({date_from:'2026-03-01',date_to:'2026-02-01'}).success).toBe(false);
    expect(dateRangeSchema.safeParse({date_from:'2026-01-01',date_to:'2026-01-01'}).success).toBe(true);
  });
  it('formats money exactly without floating-point precision loss',()=>{
    expect(rupees('123456789012345.67')).toBe('₹12,34,56,78,90,12,345.67');
    expect(rupees('-0.04')).toBe('−₹0.04');expect(rupees('0.00')).toBe('₹0.00');
  });
});
