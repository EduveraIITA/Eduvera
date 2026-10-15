import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHandler,settings} from '../server.mjs';

// Read-only visual review. The persistent enquiry flow is exercised separately
// by browser.mjs against its isolated PostgreSQL database.
const server=createServer(createHandler({db:{query:async()=>({rows:[]})},config:settings({})}));
await new Promise(r=>server.listen(8081,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
await mkdir('screenshots',{recursive:true});
try{
 for(const [name,width,height,colorScheme,reducedMotion] of [
  ['desktop',1440,1000,'light','no-preference'],['mobile',390,844,'light','reduce'],
  ['small-mobile',320,800,'light','reduce'],['tablet',768,1024,'light','reduce'],
  ['dark-desktop',1440,1000,'dark','reduce'],['dark-mobile',390,844,'dark','reduce']
 ]) {
  const page=await browser.newPage({viewport:{width,height},colorScheme,reducedMotion});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8081/',{waitUntil:'networkidle'});
  await page.screenshot({path:`screenshots/${name}-hero.png`});
  for(const selector of ['#features','.planning-section','#solutions','#contact']) {
   await page.locator(selector).scrollIntoViewIfNeeded();await page.waitForTimeout(800);
   await page.screenshot({path:`screenshots/${name}-${selector.replace(/[#.]/g,'')}.png`});
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: page overflow`);
  for(const label of ['Attendance','Insights','For teachers','For families']) {
   await page.getByRole('tab',{name:label,exact:true}).click();
   await page.locator('#workflow-panel').scrollIntoViewIfNeeded();
   await page.getByRole('button',{name:'Explore this screen'}).click();
   assert(await page.getByRole('dialog').isVisible());
   await page.keyboard.press('Escape');
   assert(!(await page.getByRole('dialog').count()));
  }
  assert(await page.evaluate(()=>[...document.images].filter(i=>i.loading!=='lazy'||i.complete).every(i=>i.naturalWidth>0)),`${name}: broken image`);
  if(width<768){await page.getByRole('button',{name:'Open navigation'}).click();await page.getByRole('navigation').getByRole('link',{name:'About',exact:true}).click();assert.equal(new URL(page.url()).hash,'#about');}
  assert.deepEqual(errors,[]);console.log(`${name}: screenshots, overflow, gallery, dialog, keyboard, images passed`);
  await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
