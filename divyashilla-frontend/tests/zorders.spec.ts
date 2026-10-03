import { expect,test,type Page } from '@playwright/test';
test.beforeEach(async({request})=>{expect((await request.post('http://127.0.0.1:3180/__test/reset-rate-limiters')).status()).toBe(204);});
async function login(page:Page,username='ayush'){await page.goto('/login');await page.getByLabel('Username',{exact:true}).fill(username);await page.getByLabel('Password',{exact:true}).fill('Test-only-password-123!');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(username==='tanaji'?/\/workspace$/:/\/dashboard$/);}
async function choose(page:Page,label:string,query:string){await page.getByRole('button',{name:'Choose '+label.toLowerCase(),exact:true}).click();const group=page.getByRole('group',{name:label+' selection',exact:true});await group.getByLabel('Search '+label.toLowerCase()+' options',{exact:true}).fill(query);await group.getByRole('button',{name:'Search',exact:true}).click();await group.getByRole('button',{name:new RegExp(query)}).click();}
async function create(page:Page,name:string,buying='3000'){
  await page.goto('/orders/new');await expect(page.getByRole('heading',{name:'Create order',exact:true})).toBeVisible();
  await choose(page,'Customer','Sample customer 25');await choose(page,'Design','701');await choose(page,'Supplier','Sample artisan');
  await page.getByLabel('Selling price (₹)',{exact:true}).fill('5000');await page.getByLabel('Buying price (₹)',{exact:true}).fill(buying);
  await page.getByLabel('Agreed advance (₹)',{exact:true}).fill('500');await page.getByLabel('Additional work',{exact:true}).fill(name);
  await page.getByRole('button',{name:'Create order',exact:true}).click();await expect(page).toHaveURL(/\/orders\/[0-9a-f-]+$/);return page.url().split('/').at(-1)!;
}
async function status(page:Page,label:string){await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('dialog').getByLabel('Status change reason').fill('Browser status test');await page.getByRole('dialog').getByRole('button',{name:'Confirm status change'}).click();}
async function me(page:Page){return (await page.request.get('/api/v1/auth/me')).json();}
const headers=(token:string)=>({Origin:'http://localhost:5173','X-CSRF-Token':token});
test('order list filters and server pagination work, including empty and invalid URLs',async({page})=>{
  await login(page);await page.goto('/orders?limit=10');await expect(page.getByRole('table')).toBeVisible();await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.getByText(/Page 2 of/)).toBeVisible();
  await page.getByLabel('Search orders').fill('Sent fixture recipient');await page.getByRole('button',{name:'Apply filters'}).click();await expect(page.getByText('1 order',{exact:true})).toBeVisible();
  await page.getByLabel('Order status filter').selectOption('READY_FOR_DELIVERY');await page.getByRole('button',{name:'Apply filters'}).click();await expect(page.getByText('1 order',{exact:true})).toBeVisible();
  await page.getByLabel('Search orders').fill('No such order');await page.getByRole('button',{name:'Apply filters'}).click();await expect(page.getByRole('heading',{name:'No matching orders'})).toBeVisible();
  await page.goto('/orders?order_number=bad');await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();
});
test('create/edit/status flow uses backend number, exact financials and read-only snapshots',async({page})=>{
  await login(page);const id=await create(page,'Browser carving');await expect(page.getByRole('heading',{name:/Order #\d+/})).toBeVisible();
  const detail=(await page.request.get('/api/v1/orders/'+id)).json();const row=(await detail).data;
  expect(BigInt(row.order_number)).toBeGreaterThanOrEqual(1001n);await expect(page.getByText('₹2,000.00',{exact:true})).toBeVisible();if(process.env.PHASE9_SCREENSHOT_DIR)await page.screenshot({path:process.env.PHASE9_SCREENSHOT_DIR+'/orders-detail-desktop.png',fullPage:true});
  await expect(page.getByRole('heading',{name:'Customer snapshot'})).toBeVisible();await expect(page.getByText('Sample customer 25',{exact:true})).toBeVisible();await expect(page.getByText('4 feet',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Edit order',exact:true}).click();await page.getByLabel('Selling price (₹)',{exact:true}).fill('5500');await page.getByRole('button',{name:'Save order changes'}).click();await expect(page.getByText('Order updated.')).toBeVisible();await expect(page.getByText('₹2,500.00',{exact:true})).toBeVisible();
  await status(page,'Mark as In work');await expect(page.getByRole('button',{name:'Mark as Ready for delivery'})).toBeVisible();
  await page.getByRole('link',{name:'Edit order',exact:true}).click();await expect(page.getByRole('button',{name:'Choose customer',exact:true})).toBeDisabled();await page.getByRole('link',{name:'Cancel',exact:true}).click();
  await status(page,'Mark as Ready for delivery');await expect(page.getByRole('button',{name:'Mark as Delivered'})).toBeVisible();await status(page,'Mark as Delivered');await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Sent delivery');await page.getByRole('dialog').getByRole('button',{name:'Keep current status'}).click();
  await status(page,'Cancel order');await expect(page.getByRole('link',{name:'Edit order',exact:true})).toHaveCount(0);await page.goto('/orders/'+id+'/edit');await expect(page.getByRole('heading',{name:'This order is closed'})).toBeVisible();
});
test('missing buying price keeps profit unknown and blocks work until details are completed',async({page})=>{
  await login(page);await create(page,'Unknown buying fixture','');await expect(page.getByText('Profit is not known until the buying price is recorded.')).toBeVisible();
  await status(page,'Mark as In work');await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Supplier and buying price');await page.getByRole('dialog').getByRole('button',{name:'Keep current status'}).click();
});
test('a Sent fixture can be completed; snapshots survive master edits and order edits',async({page})=>{
  await login(page);await page.goto('/orders?q=Sent+fixture+recipient');await expect(page.getByText('1 order',{exact:true})).toBeVisible();await page.getByRole('link',{name:/View order/}).click();await status(page,'Mark as Delivered');await expect(page.getByRole('link',{name:'Edit order',exact:true})).toHaveCount(0);
  const id=await create(page,'Snapshot fixture');const row=(await (await page.request.get('/api/v1/orders/'+id)).json()).data,session=await me(page);
  try {
    expect((await page.request.patch('/api/v1/customers/'+row.customer_id,{headers:headers(session.csrfToken),data:{name:'Changed master name'}})).ok()).toBe(true);
    await page.reload();await expect(page.getByText('Sample customer 25',{exact:true})).toBeVisible();
    await page.getByRole('link',{name:'Edit order',exact:true}).click();await page.getByLabel('Additional work').fill('Snapshot retained');await page.getByRole('button',{name:'Save order changes'}).click();await expect(page.getByText('Sample customer 25',{exact:true})).toBeVisible();
  } finally {await page.request.patch('/api/v1/customers/'+row.customer_id,{headers:headers(session.csrfToken),data:{name:'Sample customer 25'}});}
});
test('stale versions retain unsaved form values and require explicit reload',async({page})=>{
  await login(page);const id=await create(page,'Concurrent fixture');await page.getByRole('link',{name:'Edit order',exact:true}).click();await expect(page.getByLabel('Selling price (₹)',{exact:true})).toHaveValue('5000.00');
  const session=await me(page),row=(await (await page.request.get('/api/v1/orders/'+id)).json()).data;
  expect((await page.request.patch('/api/v1/orders/'+id,{headers:headers(session.csrfToken),data:{version:row.version,additional_work:'Another user edit'}})).ok()).toBe(true);
  await page.getByLabel('Selling price (₹)',{exact:true}).fill('5200');await page.getByRole('button',{name:'Save order changes'}).click();await expect(page.getByRole('alert')).toContainText('Order changed');await expect(page.getByLabel('Selling price (₹)',{exact:true})).toHaveValue('5200');
  await page.getByRole('button',{name:'Reload latest order'}).click();await expect(page.getByLabel('Additional work')).toHaveValue('Another user edit');
});
test('DELIVERY routes deny order requests and mobile order forms do not overflow',async({page})=>{
  await login(page,'tanaji');await page.goto('/orders/new');await expect(page).toHaveURL(/\/workspace$/);expect((await page.request.get('/api/v1/orders')).status()).toBe(403);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await login(page);await page.setViewportSize({width:390,height:844});await page.goto('/orders/new');await expect(page.getByRole('heading',{name:'Create order',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(process.env.PHASE9_SCREENSHOT_DIR)await page.screenshot({path:process.env.PHASE9_SCREENSHOT_DIR+'/orders-create-mobile.png',fullPage:true});await page.getByRole('button',{name:'Create order',exact:true}).click();await expect(page.getByText('Choose a customer.',{exact:true})).toBeVisible();
  await page.goto('/orders');await expect(page.getByRole('table')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(process.env.PHASE9_SCREENSHOT_DIR)await page.screenshot({path:process.env.PHASE9_SCREENSHOT_DIR+'/orders-list-mobile.png',fullPage:true});
});
