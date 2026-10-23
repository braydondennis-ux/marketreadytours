const {test,expect}=require('@playwright/test');
const {execFileSync}=require('node:child_process');
let assets;
test.beforeAll(async()=>{assets=await import('../scripts/browser-assets.mjs').then(m=>m.browserAssets());});
test.beforeEach(async({page})=>{
 await fetch('http://127.0.0.1:9000/.json?ns=mrt-local-audit',{method:'PUT',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:'{}'});
 execFileSync(process.execPath,['scripts/seed-emulator.mjs'],{stdio:'pipe'});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(['127.0.0.1','localhost'].includes(url.hostname))return route.continue();
  if(assets.has(url.href))return route.fulfill({status:200,body:assets.get(url.href),contentType:'application/javascript',headers:{'access-control-allow-origin':'*'}});
  if(url.hostname==='marketready-tours-default-rtdb.firebaseio.com'&&/^\/mrt_(tours|ratings)_public\.json$/.test(url.pathname)){
   const response=await fetch('http://127.0.0.1:9000'+url.pathname+'?ns=mrt-local-audit');return route.fulfill({status:response.status,body:await response.text(),contentType:'application/json',headers:{'access-control-allow-origin':'*'}});
  }
  return route.abort(); // No production API, email, checkout, maps or tracking requests.
 });
});
async function login(page){
 await page.goto('/app/#/');await page.getByRole('button',{name:'Login',exact:true}).click();
 await page.getByPlaceholder('Email address',{exact:true}).fill('admin@example.com');
 await page.getByPlaceholder('Password',{exact:true}).fill('test1234');await page.getByRole('button',{name:'Sign In',exact:true}).click();
 await expect(page.getByRole('button',{name:'Login',exact:true})).toHaveCount(0);
 await page.goto('/app/#/tour/tour-demo-1');await page.getByRole('button',{name:/Manage Edit Stops/}).click();
}
test('landing Next tour opens the exact tour and fresh attendees see Rate Home',async({page})=>{
 await page.goto('/');await page.locator('#next').click();await expect(page).toHaveURL(/\/app\/#\/tour\/tour-demo-1$/);
 await expect(page.getByText('Demo North Tour',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Rate Home',exact:true}).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'Re-Rate',exact:true})).toHaveCount(0);
});
test('inline save failure retains editor, then a real retry persists',async({page})=>{
 await login(page);await page.getByRole('button',{name:'Edit 100 Demo St',exact:true}).click();
 const panel=page.getByRole('button',{name:'Save Changes',exact:true}).first();
 const inputs=page.locator('input'); // The inline editor is the only property text input group.
 await inputs.first().fill('101 Saved Street');
 await page.route('**/us-central1/saveTour',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":{"message":"Service unavailable","status":"UNAVAILABLE"}}'}));
 await panel.click();await expect(page.getByText(/^Service unavailable/)).toBeVisible();await expect(inputs.first()).toHaveValue('101 Saved Street');
 await page.unroute('**/us-central1/saveTour');await panel.click();await expect(page.getByText('Listing updated and saved',{exact:false})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:/Manage Edit Stops/}).click();await expect(page.getByRole('button',{name:'Edit 101 Saved Street',exact:true})).toBeVisible();
});
test('admin listing draft survives refresh and Cancel clears it',async({page})=>{
 await login(page);await page.getByRole('button',{name:/Add New Listing/}).click();
 await page.getByPlaceholder('Start typing an address...').fill('123 Unsaved Draft Lane');await page.reload();
 await page.getByRole('button',{name:/Manage Edit Stops/}).click();await page.getByRole('button',{name:/Add New Listing/}).click();
 await expect(page.getByPlaceholder('Start typing an address...')).toHaveValue('123 Unsaved Draft Lane');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:/Add New Listing/}).click();
 await expect(page.getByPlaceholder('Start typing an address...')).toBeEmpty();
});
test('signup requires intent and correct missing-field messages',async({page})=>{
 await page.goto('/app/#/tour-signup');await page.getByPlaceholder('Full Name *').fill('Browser Test');await page.getByPlaceholder('Email Address *').fill('browser@example.com');
 await page.getByRole('button',{name:'Submit Listing Request',exact:true}).click();await expect(page.getByText(/Choose Include my listing/)).toBeVisible();
 await page.getByRole('button',{name:'Include my listing',exact:true}).click();await page.getByRole('button',{name:'Submit Listing Request',exact:true}).click();
 await expect(page.getByText(/Please complete:.*Property Address/)).toBeVisible();
});
test('rating failure preserves feedback; retry stores the evaluation and durable email receipt',async({page})=>{
 await page.goto('/app/#/tour/tour-demo-1');await page.getByRole('button',{name:'Rate Home',exact:true}).first().click();
 await page.getByLabel('4-digit tour code').fill('1234');await page.getByRole('button',{name:'Unlock tour'}).click();
 const stars=page.getByRole('button',{name:'Rate 5 out of 5',exact:true});await expect(stars).toHaveCount(10);
 for(let i=0;i<10;i++)await stars.nth(i).click();
 await page.locator('#mrt-rating-note').fill('Browser feedback survives a failed request');
 await page.route('**/us-central1/submitRating',route=>route.abort('failed'));
 await page.getByRole('button',{name:'Submit rating'}).click();await expect(page.getByText(/Could not confirm your rating was saved/)).toBeVisible();
 await expect(page.locator('#mrt-rating-note')).toHaveValue('Browser feedback survives a failed request');
 await page.unroute('**/us-central1/submitRating');await page.getByRole('button',{name:'Submit rating'}).click();
 await expect(page.getByText('Feedback saved for',{exact:false})).toBeVisible();
 const read=async path=>(await fetch('http://127.0.0.1:9000/'+path+'.json?ns=mrt-local-audit',{headers:{Authorization:'Bearer owner'}})).json();
 const ratings=await read('mrt_ratings_private/tour-demo-1/listing-1');expect(Object.values(ratings).some(r=>r.suggestions==='Browser feedback survives a failed request')).toBeTruthy();
 const outbox=Object.values(await read('mrt_email_outbox')||{});expect(outbox.some(job=>job.status==='sent'&&job.message.text.includes('Browser feedback survives a failed request'))).toBeTruthy();
});
test('attendance signup appears in Requests and its prefilled listing saves successfully',async({page})=>{
 await page.goto('/app/#/tour-signup');await page.getByPlaceholder('Full Name *').fill('Browser Attendee');await page.getByPlaceholder('Email Address *').fill('attendee@example.com');
 await page.getByRole('button',{name:'Attend without a listing',exact:true}).click();await page.getByRole('button',{name:/Demo North Tour/}).click();
 await page.getByRole('button',{name:'Sign Up for Tour',exact:true}).click();
 const read=async path=>(await fetch('http://127.0.0.1:9000/'+path+'.json?ns=mrt-local-audit',{headers:{Authorization:'Bearer owner'}})).json();
 await expect.poll(async()=>Object.keys(await read('mrt_tour_requests')||{}).length).toBe(1);
 await login(page);await page.goto('/app/#/requests-admin');await page.getByRole('button',{name:/Attendance/}).click();
 await page.getByRole('button',{name:'Add a listing',exact:true}).click();
 await page.getByPlaceholder('Start typing an address...').fill('300 Browser Listing Way');
 await expect(page.getByPlaceholder('Agent Email')).toHaveValue('attendee@example.com');await page.getByRole('button',{name:'Add Listing',exact:true}).click();
 await expect.poll(async()=>{const t=await read('mrt_tours_private/tour-demo-1');return(t.listings||[]).some(l=>l.address==='300 Browser Listing Way')}).toBeTruthy();
 expect(Object.keys(await read('mrt_tour_requests')).length).toBe(1);
});
