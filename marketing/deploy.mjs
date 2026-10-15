import {allowedDeploymentOrigins} from './deploy-config.mjs';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {appendFileSync,writeFileSync,unlinkSync} from 'node:fs';
// This script never updates eduvera-stage, its traffic, authentication or DNS.
const project='eduera-511111',region='asia-south1',service='thatcampus-web';
if(process.env.GITHUB_REPOSITORY!=='EduveraIITA/Eduvera'||process.env.GITHUB_REF!=='refs/heads/Stage'||!/^[a-f0-9]{40}$/.test(process.env.RELEASE_SHA||''))throw new Error('Only a tested Stage release may deploy');
const flags=[`--project=${project}`,`--region=${region}`,'--quiet'];
const g=args=>execFileSync('gcloud',args,{encoding:'utf8',stdio:['ignore','pipe','inherit']}).trim();
const app=JSON.parse(g(['run','services','describe','eduvera-stage',...flags,'--format=json']));
const template=app.spec.template.spec;
const db=template.containers[0].env.find(e=>e.name==='DATABASE_URL');
if(!db?.valueFrom?.secretKeyRef)throw new Error('Existing app database must use Secret Manager');
// Schema is deployed by the normal Stage migrator. This read-only probe checks
// readiness before exposing the form. It never runs application migrations.
// The FORM_SECRET must be provisioned once; no shared authentication secrets.
try{g(['secrets','describe','thatcampus-form-secret',`--project=${project}`,'--format=value(name)']);}catch{try{execFileSync('gcloud',['secrets','create','thatcampus-form-secret',`--project=${project}`,'--replication-policy=automatic','--data-file=-','--quiet'],{input:randomBytes(48).toString('base64url'),stdio:['pipe','ignore','inherit']});g(['secrets','add-iam-policy-binding','thatcampus-form-secret',`--project=${project}`,'--member=serviceAccount:stage-runtime@eduera-511111.iam.gserviceaccount.com','--role=roles/secretmanager.secretAccessor','--quiet']);}catch{throw new Error('Provisioning thatcampus-form-secret failed. A project administrator must create this Secret Manager secret and grant stage-runtime secretAccessor. See docs/marketing/DEPLOYMENT.md.');}}
const env={NODE_ENV:'production',RELEASE_SHA:process.env.RELEASE_SHA,LOGIN_URL:'https://app.thatcampus.com/login',ALLOWED_ORIGINS:'https://thatcampus-web-367469594690.asia-south1.run.app,https://thatcampus.com,https://www.thatcampus.com'};
writeFileSync('/tmp/thatcampus-env.json',JSON.stringify(env),{mode:0o600});
const image=`asia-south1-docker.pkg.dev/${project}/eduera/thatcampus:${process.env.RELEASE_SHA}`;
const tag=`check-${process.env.RELEASE_SHA.slice(0,12)}`;
let previous;
try{const current=JSON.parse(g(['run','services','describe',service,...flags,'--format=json']));previous=current.status.traffic?.find(t=>t.percent===100)?.revisionName;}catch{ /* First deployment. */ }
const deploy=['run','deploy',service,...flags,`--image=${image}`,'--service-account=stage-runtime@eduera-511111.iam.gserviceaccount.com','--cpu=1','--memory=256Mi','--min=0','--max=1','--concurrency=40','--timeout=30','--cpu-throttling','--no-cpu-boost','--ingress=all','--allow-unauthenticated','--env-vars-file=/tmp/thatcampus-env.json',`--set-secrets=DATABASE_URL=${db.valueFrom.secretKeyRef.name}:${db.valueFrom.secretKeyRef.key},FORM_SECRET=thatcampus-form-secret:latest`,`--tag=${tag}`];
const cloudsql=app.spec.template.metadata?.annotations?.['run.googleapis.com/cloudsql-instances'];if(cloudsql)deploy.push(`--add-cloudsql-instances=${cloudsql}`);
if(previous)deploy.push('--no-traffic');
let promoted=false;
async function verify(origin){for(const path of ['/','/privacy','/terms','/sitemap.xml','/robots.txt','/thatcampus-logo.png']){const r=await fetch(origin+path,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`Public verification failed: ${path} ${r.status}`);}const config=await(await fetch(origin+'/api/config')).json();if(config.loginUrl!==env.LOGIN_URL)throw new Error('Wrong login destination');const ready=await(await fetch(origin+'/readyz',{signal:AbortSignal.timeout(20000)})).json();if(ready.status!=='ready'||ready.release!==process.env.RELEASE_SHA)throw new Error('Wrong release or database not ready');}
try{
 g(deploy);let site=JSON.parse(g(['run','services','describe',service,...flags,'--format=json']));let candidate=site.status.traffic.find(t=>t.tag===tag);if(!candidate?.url||!candidate.revisionName)throw new Error('Candidate URL missing');
 const origins=allowedDeploymentOrigins(site.status.url,candidate.url);
 g(['run','services','update',service,...flags,`--update-env-vars=^|^ALLOWED_ORIGINS=${origins}`,'--no-traffic',`--tag=${tag}`]);
 site=JSON.parse(g(['run','services','describe',service,...flags,'--format=json']));candidate=site.status.traffic.find(t=>t.tag===tag);if(!candidate?.url||!candidate.revisionName)throw new Error('Configured candidate URL missing');
 // Wait briefly for the normal Stage pipeline to apply the additive migration.
 let ready=false;for(let i=0;i<40;i++){try{await verify(candidate.url);ready=true;break;}catch{await new Promise(r=>setTimeout(r,15000));}}if(!ready)throw new Error('Candidate not ready. Verify marketing migrations 094–095 in the Stage release.');
 promoted=true;g(['run','services','update-traffic',service,...flags,`--to-revisions=${candidate.revisionName}=100`]);await verify(site.status.url);
 const appResponse=await fetch(env.LOGIN_URL,{signal:AbortSignal.timeout(20000)});if(!appResponse.ok)throw new Error('Existing app login is not reachable');
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`## ThatCampus deployed\n\n${site.status.url}\n\nRelease ${process.env.RELEASE_SHA}. Website, legal routes, SEO assets, database readiness, login destination and existing app HTTP availability verified. DNS remains unchanged.\n`);
 console.log(`Verified website: ${site.status.url}`);
}catch(error){if(previous&&promoted)g(['run','services','update-traffic',service,...flags,`--to-revisions=${previous}=100`]);throw error;}finally{unlinkSync('/tmp/thatcampus-env.json');}
