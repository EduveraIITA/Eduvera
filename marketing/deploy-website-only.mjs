import {execFileSync} from 'node:child_process';
import {appendFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const release=process.env.RELEASE_SHA;
if(process.env.GITHUB_REPOSITORY!=='EduveraIITA/Eduvera'||process.env.GITHUB_REF!=='refs/heads/Stage'||!/^[a-f0-9]{40}$/.test(release||''))throw Error('Only a verified Stage website release may deploy');
const flags=['--project=eduera-511111','--region=asia-south1','--quiet'];
const g=args=>execFileSync('gcloud',args,{encoding:'utf8',stdio:['ignore','pipe','inherit']}).trim();
const describe=name=>JSON.parse(g(['run','services','describe',name,...flags,'--format=json']));
const original=describe('thatcampus-web');
const appBefore=describe('eduvera-stage');
const previous=original.status.traffic.find(t=>t.percent===100)?.revisionName;
if(!previous)throw Error('Expected one existing website revision receiving 100% traffic');
const env=original.spec.template.spec.containers[0].env;
const login=env.find(e=>e.name==='LOGIN_URL')?.value;
if(!login)throw Error('The current website must have an explicit Login configuration');
const baseline=JSON.parse(readFileSync(new URL('./test/showcase-baseline.json',import.meta.url)));
const tag=`stitch-${release.slice(0,12)}`;
const hash=value=>createHash('sha256').update(value).digest('hex');
async function verify(origin){
 for(const path of ['/','/privacy','/terms','/robots.txt','/sitemap.xml']){
  const response=await fetch(origin+path,{signal:AbortSignal.timeout(30000)});
  assert(response.ok,`${path}: HTTP ${response.status}`);
  if(path==='/')assert((await response.text()).includes('One Campus.'));
 }
 const ready=await(await fetch(origin+'/readyz',{signal:AbortSignal.timeout(30000)})).json();
 assert.equal(ready.status,'ready');assert.equal(ready.release,release);
 assert.equal((await(await fetch(origin+'/api/config')).json()).loginUrl,login);
 for(const [path,expected] of Object.entries(baseline.files).filter(([path])=>path.startsWith('public/'))){
  const response=await fetch(origin+'/'+path.slice(7),{signal:AbortSignal.timeout(30000)});
  assert(response.ok,path);assert.equal(hash(Buffer.from(await response.arrayBuffer())),expected,path);
 }
}
let promoted=false;
try{
 // Image + release identifier only: retain secrets, identity, networking, limits,
 // scaling, database connections, Login URL, origin allowlist and domain settings.
 g(['run','services','update','thatcampus-web',...flags,`--image=asia-south1-docker.pkg.dev/eduera-511111/eduera/thatcampus:${release}`,`--update-env-vars=RELEASE_SHA=${release}`,'--no-traffic',`--tag=${tag}`]);
 const site=describe('thatcampus-web');const candidate=site.status.traffic.find(t=>t.tag===tag);
 assert(candidate?.url&&candidate.revisionName,'Missing candidate');
 const retained=site.spec.template.spec.containers[0].env.filter(e=>e.name!=='RELEASE_SHA').sort((a,b)=>a.name.localeCompare(b.name));
 assert.deepEqual(retained,env.filter(e=>e.name!=='RELEASE_SHA').sort((a,b)=>a.name.localeCompare(b.name)),'Website environment changed');
 await verify(candidate.url);
 execFileSync(process.execPath,['test/remote-preview.mjs',candidate.url,login],{cwd:new URL('.',import.meta.url),stdio:'inherit'});
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`## Verified no-traffic preview\n${candidate.url}\n\nAll original screenshot bytes preserved. Responsive gallery, dialogs and navigation checked before promotion.\n`);
 promoted=true;g(['run','services','update-traffic','thatcampus-web',...flags,`--to-revisions=${candidate.revisionName}=100`]);
 await verify(site.status.url);await verify('https://www.thatcampus.com');
 assert((await fetch(login,{signal:AbortSignal.timeout(30000)})).ok,'Existing Login not reachable');
 const appAfter=describe('eduvera-stage');assert.deepEqual(appAfter.spec,appBefore.spec,'Application config changed concurrently');assert.deepEqual(appAfter.status.traffic,appBefore.status.traffic,'Application traffic changed concurrently');
 console.log(`Verified redesigned website: https://www.thatcampus.com; release ${release}`);
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`## Production verified\nhttps://www.thatcampus.com\n\nRelease ${release}. Existing application configuration and traffic unchanged.\n`);
}catch(error){if(promoted)g(['run','services','update-traffic','thatcampus-web',...flags,`--to-revisions=${previous}=100`]);throw error;}
