import { expect,test,type Page } from '@playwright/test';
test.beforeEach(async({request})=>{expect((await request.post('http://127.0.0.1:3180/__test/reset-rate-limiters')).status()).toBe(204);});
const password='Test-only-password-123!';
async function login(page:Page,username='ayush') {
  await page.goto('/login');await page.getByLabel('Username',{exact:true}).fill(username);
  await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page).toHaveURL(username==='tanaji'?/\/workspace$/:username==='temporary'?/\/change-password$/:/\/dashboard$/);
}
test('ADMIN dashboard restores cookie session and logout removes protected access',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await login(page);await expect(page.getByRole('heading',{name:'Welcome, Ayush'})).toBeVisible();
  await expect(page.getByText('₹35,000.00').first()).toBeVisible();
  if(process.env.PHASE8_SCREENSHOT_DIR) await page.screenshot({path:process.env.PHASE8_SCREENSHOT_DIR+'/desktop.png',fullPage:true});
  await page.reload();
  await expect(page.getByRole('heading',{name:'Welcome, Ayush'})).toBeVisible();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in to your workspace'})).toBeVisible();
  await page.goto('/customers');await expect(page.getByRole('heading',{name:'Sign in to your workspace'})).toBeVisible();
});
test('customer create/read/edit/deactivate/reactivate, search and exact filters work with real APIs',async({page})=>{
  await login(page);await page.getByRole('link',{name:'Customers',exact:true}).click();
  await expect(page.getByText('25 customers',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.getByText(/Page 2 of 2/)).toBeVisible();await page.getByRole('button',{name:'Reset',exact:true}).click();
  await page.getByRole('link',{name:'Add customer',exact:true}).click();await page.getByRole('button',{name:'Create customer',exact:true}).click();
  await expect(page.getByText('This field is required.').first()).toBeVisible();
  await page.getByLabel('Name',{exact:false}).fill('Browser customer');await page.getByLabel('Phone number').fill('+91 (98765) 43210');
  await page.getByLabel('City',{exact:false}).fill('Pune');await page.getByLabel('Address',{exact:true}).fill('Test address\nमराठी');
  await page.getByRole('button',{name:'Create customer',exact:true}).click();await expect(page.getByText('Customer created.')).toBeVisible();
  await page.getByLabel('Search customers').fill('Browser customer');await page.getByRole('button',{name:'Apply filters'}).click();
  await expect(page.getByText('1 customer',{exact:true})).toBeVisible();await page.getByRole('link',{name:'View Browser customer',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Browser customer',exact:true})).toBeVisible();await expect(page.getByText('+919876543210',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Edit customer',exact:true}).click();await page.getByLabel('City',{exact:false}).fill('Kolhapur');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByText('Customer updated.')).toBeVisible();
  await page.getByLabel('Search customers').fill('Browser customer');await page.getByLabel('Exact city').fill('Kolhapur');
  await page.getByRole('button',{name:'Apply filters'}).click();await page.getByRole('button',{name:'Deactivate Browser customer',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Not currently active');await page.getByRole('dialog').getByRole('button',{name:'Deactivate',exact:true}).click();
  await expect(page.getByRole('heading',{name:'No matching records'})).toBeVisible();
  await page.getByLabel('Status',{exact:true}).selectOption('inactive');await page.getByRole('button',{name:'Apply filters'}).click();
  await page.getByRole('button',{name:'Reactivate Browser customer',exact:true}).click();await page.getByRole('dialog').getByLabel('Reason').fill('Customer returned');
  await page.getByRole('dialog').getByRole('button',{name:'Reactivate',exact:true}).click();await expect(page.getByRole('heading',{name:'No matching records'})).toBeVisible();
});
test('design forms preserve sizes, reject duplicate numbers and update/read catalog records',async({page})=>{
  await login(page);await page.getByRole('link',{name:'Designs',exact:true}).click();await page.getByRole('link',{name:'Add design',exact:true}).click();await expect(page.getByRole('heading',{name:'Add design',exact:true})).toBeVisible();
  await page.getByLabel('Design number').fill('701');await page.getByLabel('Design name').fill('Browser stone');
  await page.getByLabel('Size',{exact:false}).fill('3.15 feet');await page.getByLabel('Material',{exact:false}).fill('Stone');
  await page.getByRole('button',{name:'Create design',exact:true}).click();await expect(page.getByRole('alert')).toContainText('already exists');
  await page.getByLabel('Design number').fill('BROWSER-702');await page.getByRole('button',{name:'Create design',exact:true}).click();
  await expect(page.getByText('Design created.')).toBeVisible();await page.getByLabel('Search designs').fill('BROWSER-702');await page.getByRole('button',{name:'Apply filters'}).click();
  await page.getByRole('link',{name:'View Browser stone',exact:true}).click();await expect(page.getByText('3.15 feet',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Edit design',exact:true}).click();await page.getByLabel('Notes').fill('Carving notes');await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page.getByText('Design updated.')).toBeVisible();
});
test('supplier create, optional city, edit and deactivate screens work',async({page})=>{
  await login(page);await page.getByRole('link',{name:'Suppliers',exact:true}).click();await page.getByRole('link',{name:'Add supplier',exact:true}).click();
  await page.getByLabel('Name',{exact:false}).fill('Browser artisan');await page.getByLabel('Phone number').fill('9876543212');
  await page.getByRole('button',{name:'Create supplier',exact:true}).click();await expect(page.getByText('Supplier created.')).toBeVisible();
  await page.getByLabel('Search suppliers').fill('Browser artisan');await page.getByRole('button',{name:'Apply filters'}).click();await page.getByRole('link',{name:'View Browser artisan',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Browser artisan'})).toBeVisible();await page.getByRole('link',{name:'Edit supplier'}).click();
  await page.getByLabel('City',{exact:false}).fill('Kolhapur');await page.getByRole('button',{name:'Save changes'}).click();
  await page.getByLabel('Search suppliers').fill('Browser artisan');await page.getByRole('button',{name:'Apply filters'}).click();
  await page.getByRole('button',{name:'Deactivate Browser artisan',exact:true}).click();await page.getByRole('dialog').getByLabel('Reason').fill('Inactive supplier');
  await page.getByRole('dialog').getByRole('button',{name:'Deactivate',exact:true}).click();await expect(page.getByRole('heading',{name:'No matching records'})).toBeVisible();
});
test('DELIVERY cannot load ADMIN pages or reports through cookies',async({page})=>{
  await login(page,'tanaji');await expect(page.getByRole('heading',{name:'Welcome, Tanaji'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Customers',exact:true})).toHaveCount(0);
  await page.goto('/dashboard');await expect(page).toHaveURL(/\/workspace$/);
  const status=await page.evaluate(async()=> (await fetch('/api/v1/reports/dashboard',{credentials:'include'})).status);expect(status).toBe(403);
  await page.goto('/customers/new');await expect(page).toHaveURL(/\/workspace$/);
});
test('first login forces password change and rotates into an authorized session',async({page})=>{
  await login(page,'temporary');await expect(page.getByRole('heading',{name:'Choose your own password'})).toBeVisible();
  await page.getByLabel('Current password',{exact:true}).fill(password);await page.getByLabel('New password',{exact:true}).fill('Changed-test-password-123!');
  await page.getByLabel('Confirm new password',{exact:true}).fill('Mismatch-test-password');await page.getByRole('button',{name:'Save password'}).click();
  await expect(page.getByText('Passwords do not match.')).toBeVisible();await page.getByLabel('Confirm new password',{exact:true}).fill('Changed-test-password-123!');
  await page.getByRole('button',{name:'Save password'}).click();await expect(page.getByRole('heading',{name:'Welcome, First'})).toBeVisible();
});
test('mobile layout has no page overflow, accessible navigation and usable customer cards',async({page})=>{
  await page.setViewportSize({width:390,height:844});await login(page);await expect(page.getByRole('heading',{name:'Welcome, Ayush'})).toBeVisible();
  await expect(page.getByText('₹35,000.00').first()).toBeVisible();
  for(const width of [320,768,390]) {await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}
  if(process.env.PHASE8_SCREENSHOT_DIR) await page.screenshot({path:process.env.PHASE8_SCREENSHOT_DIR+'/mobile.png'});
  await page.getByRole('button',{name:'Open navigation'}).click();await page.getByRole('dialog').getByRole('link',{name:'Customers',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Customers',exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await expect(page.getByRole('table')).toBeVisible();
  if(process.env.PHASE8_SCREENSHOT_DIR) await page.screenshot({path:process.env.PHASE8_SCREENSHOT_DIR+'/mobile-customers.png'});
  await page.getByRole('link',{name:'Add customer',exact:true}).click();await expect(page.getByLabel('Phone number')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('loading, retryable errors, empty searches and expired sessions are visible',async({page})=>{
  await login(page);await page.route('**/api/v1/customers?*',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{code:'INTERNAL_ERROR',message:'Please try again.'}})}));
  await page.goto('/customers?q=anything');await expect(page.getByRole('heading',{name:'Customers'})).toBeVisible();await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();
  await page.unroute('**/api/v1/customers?*');await page.getByRole('button',{name:'Try again'}).click();await expect(page.getByRole('heading',{name:'No matching records'})).toBeVisible();
  await page.context().clearCookies();await page.getByRole('button',{name:'Reset',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in to your workspace'})).toBeVisible();
});
