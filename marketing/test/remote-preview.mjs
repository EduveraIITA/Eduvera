import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const [origin,login]=process.argv.slice(2);
assert(new URL(origin).hostname.endsWith('.run.app'));
await mkdir('screenshots',{recursive:true});const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
try{
 for(const width of [1440,768,390,320]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin,{waitUntil:'networkidle'});
  assert.equal(await page.locator('h1').textContent(),'A school day.Working together.');
  assert.equal(await page.locator('header .login').getAttribute('href'),login);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`screenshots/preview-${width}.png`,fullPage:true});
  assert.equal(await page.locator('.demo-film').count(),5);
  for(const name of ['attendance','timetable','family','ai-context','ai-sources']){
   const video=page.locator(`.demo-${name} .demo-device video`);await video.scrollIntoViewIfNeeded();
   await page.waitForFunction(selector=>Boolean(document.querySelector(selector)?.getAttribute('src')),`.demo-${name} .demo-device video`);
   assert.equal(await video.getAttribute('src'),`/demos/${name}.mp4`);assert(await video.evaluate(element=>element.paused));
  }
  const expand=page.getByRole('button',{name:'Enlarge attendance walkthrough',exact:true});await expand.click();
  const filmDialog=page.getByRole('dialog',{name:'Attendance walkthrough',exact:true});await filmDialog.waitFor({state:'visible'});
  assert(await filmDialog.locator('video').isVisible());await page.keyboard.press('Escape');await filmDialog.waitFor({state:'hidden'});
  assert(await expand.evaluate(button=>button===document.activeElement));
  const gallery=page.locator('details#screen-library');await gallery.locator(':scope > summary').click();
  for(const name of ['Attendance','Insights','For teachers','For families']){
   await gallery.getByRole('tab',{name,exact:true}).click();await gallery.getByRole('button',{name:'Explore this screen',exact:true}).click();
   assert(await page.getByRole('dialog').isVisible());await page.keyboard.press('Escape');
  }
  for(const name of ['Principal','Teacher','Parent','Student']){await page.getByRole('tab',{name,exact:true}).click();assert(await page.locator('#role-panel').isVisible());}
  if(width<768)await page.getByRole('button',{name:'Open navigation'}).click();
  await page.getByRole('navigation').getByRole('link',{name:'Contact',exact:true}).click();assert.equal(new URL(page.url()).hash,'#contact');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Candidate: responsive layout, deferred recorded demos, reduced motion, original gallery, dialogs, focus, roles, navigation and Login verified; no production enquiry submitted.');
}finally{await browser.close();}
