import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

assert.equal(process.env.GITHUB_REPOSITORY,'EduveraIITA/Eduvera');
assert.equal(process.env.GITHUB_REF,'refs/heads/Stage');
assert(['inspect','remove'].includes(process.env.RETIRE_MODE));
const origin='https://eduvera-stage-367469594690.asia-south1.run.app';
const ready=await fetch(origin+'/readyz',{signal:AbortSignal.timeout(15000)});
assert(ready.ok);assert.equal((await ready.json()).status,'ready');
assert.equal((await (await fetch(origin+'/api/v1/auth/session/')).json()).demo_mode,false);
const project='e502f870-10b0-4e13-b42e-124e6373a277';
const invoke=args=>execFileSync('railway',args,{encoding:'utf8',stdio:['ignore','pipe','inherit']});
// Inventory contains resource IDs/names, not rendered environment variables.
const inventory=JSON.parse(invoke(['service','list','--project',project,'--environment','stage','--json']));
console.log(JSON.stringify({project,environment:'stage',inventory}));
if(process.env.RETIRE_MODE==='remove') {
  // Pinned from read-only run 37936798220. Never select a database or another app.
  const service='bfce4d21-5994-4612-8c7b-8cd28681f7e5';
  assert(Array.isArray(inventory));
  const target=inventory.find(item=>item.id===service);
  assert.equal(target?.name,'omnischool');
  assert.equal(target?.url,'https://omnischool-stage.up.railway.app');
  console.log(invoke(['service','delete','--project',project,'--environment','stage','--service',service,'--yes','--json']));
}
