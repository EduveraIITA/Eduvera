import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';

// Captures the actual application UI against the local, synthetic CIS demo.
// No production accounts, browser profiles or institutional records are used.
const origin = 'http://127.0.0.1:8000';
const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
await mkdir('screenshots/source', {recursive:true});
try {
 for (const [role, portal, pages] of [
  ['admin','principal', [['overview',''],['attendance','/attendance'],['planner','/timetable'],['insights','/insights']]],
  ['parent','parent', [['family','']]],
  ['staff','teacher', [['teacher','']]],
 ]) {
  const context = await browser.newContext({viewport:{width:430,height:900},deviceScaleFactor:2,reducedMotion:'reduce'});
  await context.request.get(origin+'/api/v1/auth/csrf/');
  const token = (await context.cookies(origin)).find(c=>c.name==='csrftoken')?.value;
  const login = await context.request.post(origin+'/api/v1/auth/demo-session/',{data:{role},headers:{'X-CSRFToken':token}});
  if(!login.ok()) throw new Error(`Demo login failed: ${login.status()}`);
  const page = await context.newPage();
  for (const [name,path] of pages) {
   await page.goto(`${origin}/${portal}${path}`,{waitUntil:'domcontentloaded'});
   await page.waitForTimeout(2200);
   if(name==='planner') {
    await page.getByRole('combobox',{name:'Filter by class'}).selectOption({label:'Class 7A'});
    await page.getByText('Day',{exact:true}).click();
    await page.waitForTimeout(800);
   }
   // Restore the repository's original synthetic portrait when a developer's
   // local upload is absent. No student record is changed.
   if(name==='family') {
    const portrait='data:image/png;base64,'+(await readFile('../frontend/public/assets/aarav-sharma.png')).toString('base64');
    await page.evaluate(async(portrait)=>{
     for(const img of document.images) if(!img.naturalWidth) img.src=portrait;
     await Promise.all(Array.from(document.images).map(img=>img.decode().catch(()=>{})));
    },portrait);
   }
   await page.screenshot({path:`screenshots/source/${name}.png`});
   console.log(name, (await page.locator('body').innerText()).slice(0,1400));
  }
  if (portal==='principal') {
   await page.setViewportSize({width:1440,height:980});
   await page.goto(`${origin}/principal/insights`,{waitUntil:'domcontentloaded'});
   await page.waitForTimeout(2200);
   await page.screenshot({path:'screenshots/source/insights-desktop.png'});
   await page.goto(`${origin}/principal/timetable`,{waitUntil:'domcontentloaded'});
   await page.waitForTimeout(1800);
   await page.getByRole('combobox',{name:'Filter by class'}).selectOption({label:'Class 7A'});
   await page.getByText('Week',{exact:true}).click();
   await page.waitForTimeout(800);
   await page.screenshot({path:'screenshots/source/planner-desktop.png'});
  }
  await context.close();
 }
} finally { await browser.close(); }
