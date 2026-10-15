import {chromium} from 'playwright';
import {Pool} from 'pg';
import {createServer} from 'node:http';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHandler,settings} from '../server.mjs';
if(!process.env.MARKETING_TEST_DATABASE_URL)throw new Error('An isolated marketing test database is required');
const db=new Pool({connectionString:process.env.MARKETING_TEST_DATABASE_URL});
const server=createServer(createHandler({db,config:{...settings({}),origins:['http://127.0.0.1:8080']}}));
await new Promise(r=>server.listen(8080,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});await mkdir('screenshots',{recursive:true});
try{
 for(const [name,width,height]of[['desktop',1440,1000],['laptop',1024,900],['tablet',768,1024],['mobile',360,800],['small-mobile',320,800]]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8080/',{waitUntil:'networkidle'});
  assert.equal(await page.locator('h1').textContent(),'Not just any campus.That campus.');
  assert.equal(await page.locator('.header-actions a.login').getAttribute('href'),'https://app.thatcampus.com/login');
  assert(await page.locator('.header-actions a.login').isVisible());
  const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth);if(!fits){console.log(name,await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,cls:el.className,right:Math.round(el.getBoundingClientRect().right),width:Math.round(el.getBoundingClientRect().width)}))));await page.screenshot({path:`screenshots/${name}-overflow.png`,fullPage:true});}assert(fits,`${name}: horizontal overflow`);
  if(width<768){await page.getByRole('button',{name:'Open navigation'}).click();}
  for(const name of ['Features','Solutions','About','Contact'])assert(await page.locator('nav').getByRole('link',{name,exact:true}).isVisible());
  await page.locator('nav').getByRole('link',{name:'Features',exact:true}).click();assert.equal(new URL(page.url()).hash,'#features');
  await page.getByRole('tab',{name:'Attendance',exact:true}).click();assert(await page.getByText('Every class. Every learner. A clearer picture.',{exact:true}).isVisible());
  await page.getByRole('tab',{name:'For families'}).click();assert(await page.getByText('Closer to their school day.').isVisible());
  await page.screenshot({path:`screenshots/${name}.png`,fullPage:true});
  await page.goto('http://127.0.0.1:8080/privacy');assert(await page.getByRole('heading',{name:'Privacy Policy'}).isVisible());
  assert.deepEqual(errors,[]);await page.close();
 }
 const page=await browser.newPage();await page.goto('http://127.0.0.1:8080/');await page.locator('input[name="fullName"]').fill('Website QA');await page.locator('input[name="institution"]').fill('ThatCampus QA Institution');await page.locator('select[name="institutionType"]').selectOption('school');await page.locator('input[name="email"]').fill('website-qa@example.edu');await page.locator('input[name="phone"]').fill('+91 9000000000');await page.locator('input[name="location"]').fill('Bengaluru, Karnataka');await page.locator('input[name="students"]').fill('250');await page.locator('input[name="consent"]').check();await page.waitForTimeout(2100);await page.getByRole('button',{name:'Request a Demo',exact:true}).click();await page.getByRole('heading',{name:'You’re on our list.'}).waitFor();const result=await db.query("SELECT e.id,j.state FROM marketing_enquiries e JOIN marketing_notification_jobs j ON j.enquiry_id=e.id WHERE e.email='website-qa@example.edu'");assert.equal(result.rowCount,1);assert.equal(result.rows[0].state,'queued');await page.screenshot({path:'screenshots/enquiry-saved.png',fullPage:true});await db.query("DELETE FROM marketing_enquiries WHERE email='website-qa@example.edu'");console.log('Desktop, tablet, mobile, interactive previews, navigation, legal page, browser errors and real PostgreSQL enquiry storage passed.');
}finally{await browser.close();await new Promise(r=>server.close(r));await db.end();}
