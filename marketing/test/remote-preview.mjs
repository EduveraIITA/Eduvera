import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const [origin,login]=process.argv.slice(2);
assert(new URL(origin).hostname.endsWith('.run.app'));
await mkdir('screenshots',{recursive:true});const browser=await chromium.launch();
try{
 for(const width of [1440,768,390,320]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin,{waitUntil:'networkidle'});
  assert.equal(await page.locator('h1').textContent(),'One Campus.Everything Connected.');
  assert.equal(await page.locator('header .login').getAttribute('href'),login);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`screenshots/preview-${width}.png`,fullPage:true});
  for(const name of ['Attendance','Insights','For teachers','For families']){
   await page.getByRole('tab',{name,exact:true}).click();await page.getByRole('button',{name:'Explore this screen',exact:true}).click();
   assert(await page.getByRole('dialog').isVisible());await page.keyboard.press('Escape');
  }
  for(const name of ['Principal','Teacher','Parent','Student']){await page.getByRole('tab',{name,exact:true}).click();assert(await page.locator('#role-panel').isVisible());}
  if(width<768)await page.getByRole('button',{name:'Open navigation'}).click();
  await page.getByRole('navigation').getByRole('link',{name:'Contact',exact:true}).click();assert.equal(new URL(page.url()).hash,'#contact');
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Candidate: responsive layout, original gallery, dialogs, roles, navigation and Login verified; no production enquiry submitted.');
}finally{await browser.close();}
