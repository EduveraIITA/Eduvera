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
const names=['attendance','timetable','family','ai-context','ai-sources'];
const labels={'attendance':'attendance walkthrough','timetable':'timetable walkthrough','family':'family walkthrough','ai-context':'ai attendance walkthrough','ai-sources':'ai review walkthrough'};
const filmControl=(page,name,action)=>page.locator(`.demo-${name}`).getByRole('button',{name:`${action} ${labels[name]}`,exact:true});
const inlineVideo=name=>`.demo-${name} .demo-device video`;
async function visibleFilm(page,name) {
 await page.locator(inlineVideo(name)).scrollIntoViewIfNeeded();
 await page.waitForFunction(selector=>Boolean(document.querySelector(selector)?.getAttribute('src')),inlineVideo(name));
 assert.equal(await page.locator(inlineVideo(name)).getAttribute('src'),`/demos/${name}.mp4`);
}
async function waitForPlayback(page,name,playing) {
 await page.waitForFunction(({selector,playing})=>{
  const video=document.querySelector(selector);
  return video && (playing ? !video.paused && video.currentTime>0 : video.paused);
 },{selector:inlineVideo(name),playing}).catch(async error=>{
  const state=await page.locator(inlineVideo(name)).evaluate(video=>({paused:video.paused,time:video.currentTime,ready:video.readyState,error:video.error?.message,box:video.getBoundingClientRect().toJSON()}));
  throw new Error(`${name}: expected playing=${playing}; ${JSON.stringify(state)}`,{cause:error});
 });
}
try{
 for(const [name,width,height,colorScheme,reducedMotion] of [
  ['desktop',1440,1000,'light','no-preference'],['mobile',390,844,'light','reduce'],
  ['small-mobile',320,800,'light','reduce'],['tablet',768,1024,'light','reduce'],
  ['dark-desktop',1440,1000,'dark','reduce'],['dark-mobile',390,844,'dark','reduce']
 ]) {
  const page=await browser.newPage({viewport:{width,height},colorScheme,reducedMotion});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8081/',{waitUntil:'networkidle'});
  assert.equal(await page.locator('h1').textContent(),'A school day.Working together.');
  assert.equal(await page.locator(inlineVideo('family')).getAttribute('src'),null,`${name}: below-fold video loaded before it was near view`);
  await page.screenshot({path:`screenshots/${name}-hero.png`});
  for(const demo of names) {
   await visibleFilm(page,demo);
   await waitForPlayback(page,demo,reducedMotion!=='reduce');
   if(reducedMotion==='reduce') {
    // System reduced motion suppresses autoplay; explicit playback still works.
    await filmControl(page,demo,'Play').click();
    await waitForPlayback(page,demo,true);
    await filmControl(page,demo,'Pause').click();
    await waitForPlayback(page,demo,false);
   }
   await page.screenshot({path:`screenshots/${name}-${demo}-film.png`});
  }
  assert(await page.locator(inlineVideo('attendance')).evaluate(video=>video.paused),`${name}: offscreen video kept playing`);
  if(reducedMotion!=='reduce') {
   await page.getByRole('button',{name:'Pause motion',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'Resume motion',exact:true}).getAttribute('aria-pressed'),'true');
   for(const demo of names) {
    await visibleFilm(page,demo);await waitForPlayback(page,demo,false);
    assert(!(await filmControl(page,demo,'Play').isEnabled()),`${demo}: manual playback bypassed global pause`);
   }
   assert(await page.locator('.demo-device video').evaluateAll((videos,count)=>videos.length===count&&videos.every(video=>video.paused),names.length));
   await page.getByRole('button',{name:'Resume motion',exact:true}).click();
   await visibleFilm(page,'family');
   await waitForPlayback(page,'family',true);
  }
  await visibleFilm(page,'attendance');
  const expand=page.getByRole('button',{name:'Enlarge attendance walkthrough',exact:true});
  await expand.click();
  const filmDialog=page.getByRole('dialog',{name:'Attendance walkthrough',exact:true});
  await filmDialog.waitFor({state:'visible'});
  assert(await filmDialog.locator('video').isVisible());
  assert.equal(await filmDialog.locator('video').getAttribute('src'),'/demos/attendance.mp4');
  assert(await filmDialog.getByRole('button',{name:'Close',exact:true}).evaluate(button=>button===document.activeElement));
  await waitForPlayback(page,'attendance',false);
  await page.keyboard.press('Escape');await filmDialog.waitFor({state:'hidden'});
  assert(await expand.evaluate(button=>button===document.activeElement),`${name}: film close did not restore focus`);
  for(const role of ['Principal','Teacher','Parent','Student']) {
   const tab=page.getByRole('tab',{name:role,exact:true});await tab.click();
   assert.equal(await tab.getAttribute('aria-selected'),'true');assert(await page.locator('#role-panel').isVisible());
  }
  await page.getByRole('tab',{name:'Student',exact:true}).press('Home');
  assert.equal(await page.getByRole('tab',{name:'Principal',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByRole('tab',{name:'Principal',exact:true}).press('ArrowRight');
  assert.equal(await page.getByRole('tab',{name:'Teacher',exact:true}).getAttribute('aria-selected'),'true');
  for(const selector of ['#role-workspaces','#institution-solutions','#contact']) {
   await page.locator(selector).scrollIntoViewIfNeeded();await page.screenshot({path:`screenshots/${name}-${selector.slice(1)}.png`});
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: page overflow`);
  const gallery=page.locator('details#screen-library');
  assert.equal(await gallery.getAttribute('open'),null);
  await gallery.locator(':scope > summary').click();
  for(const label of ['Attendance','Insights','For teachers','For families']) {
   await gallery.getByRole('tab',{name:label,exact:true}).click();
   await gallery.locator('#workflow-panel').scrollIntoViewIfNeeded();
   await gallery.getByRole('button',{name:'Explore this screen',exact:true}).click();
   assert(await page.getByRole('dialog').isVisible());
   await page.keyboard.press('Escape');
   assert.equal(await page.locator('dialog[open]').count(),0);
  }
  await gallery.getByRole('tab',{name:'For families',exact:true}).press('Home');
  assert.equal(await gallery.getByRole('tab',{name:'Attendance',exact:true}).getAttribute('aria-selected'),'true');
  await gallery.locator('.planning-section').scrollIntoViewIfNeeded();await page.screenshot({path:`screenshots/${name}-planning-section.png`});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: expanded gallery overflow`);
  assert(await page.evaluate(()=>[...document.images].filter(i=>i.loading!=='lazy'||i.complete).every(i=>i.naturalWidth>0)),`${name}: broken image`);
  assert.equal(await page.locator('.film-fallback').count(),0,`${name}: a recorded demo failed to load`);
  if(width<768){await page.getByRole('button',{name:'Open navigation'}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'About',exact:true}).click();assert.equal(new URL(page.url()).hash,'#about');}
  assert.deepEqual(errors,[]);console.log(`${name}: layout, real films, motion controls, roles, preserved gallery, dialogs and focus passed`);
  await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
