import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHandler,settings} from '../server.mjs';

// A deterministic MP4 byte fixture; these tests verify transport, not decoding.
const bytes=Buffer.concat([Buffer.from('000000186674797069736f6d0000020069736f6d69736f32','hex'),Buffer.from(Array.from({length:4096},(_,i)=>i%251))]);
async function fixture(t){
 const dist=await mkdtemp(join(tmpdir(),'tc-media-test-'));
 await mkdir(join(dist,'media'));await writeFile(join(dist,'media','demo.mp4'),bytes);
 await writeFile(join(dist,'media','empty.mp4'),Buffer.alloc(0));
 await writeFile(join(dist,'media','poster.webp'),Buffer.from('poster fixture'));
 const server=createServer(createHandler({db:{query(){throw new Error('Static media must not query the database');}},config:{...settings({}),dist}}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dist,{recursive:true,force:true});});
 return {base:`http://127.0.0.1:${server.address().port}`,get:(range,options={})=>fetch(`http://127.0.0.1:${server.address().port}/media/demo.mp4`,{...options,headers:{...(range?{Range:range}:{}),...options.headers}})};
}
async function body(response){return Buffer.from(await response.arrayBuffer());}

test('MP4 GET exposes byte seeking, exact length, MIME and existing security/cache headers',async t=>{
 const f=await fixture(t);const response=await f.get(undefined,{headers:{'Accept-Encoding':'gzip'}});
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'video/mp4');
 assert.equal(response.headers.get('accept-ranges'),'bytes');assert.equal(response.headers.get('content-length'),String(bytes.length));
 assert.equal(response.headers.get('content-range'),null);assert.equal(response.headers.get('content-encoding'),null);
 assert.equal(response.headers.get('cache-control'),'public, max-age=3600');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.equal(response.headers.get('x-frame-options'),'DENY');assert.match(response.headers.get('content-security-policy'),/default-src 'self'/);
 assert.deepEqual(await body(response),bytes);
});

test('MP4 HEAD returns full representation metadata and no body, ignoring Range',async t=>{
 const f=await fixture(t);
 for(const range of [undefined,'bytes=0-1',`bytes=${bytes.length}-`]){
  const response=await f.get(range,{method:'HEAD'});assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'video/mp4');assert.equal(response.headers.get('accept-ranges'),'bytes');
  assert.equal(response.headers.get('content-length'),String(bytes.length));assert.equal(response.headers.get('content-range'),null);
  assert.equal((await body(response)).length,0);
 }
});

test('MP4 supports closed, open-ended and suffix byte ranges with inclusive boundaries',async t=>{
 const f=await fixture(t);
 const cases=[['bytes=0-1',0,1],['bytes=24-87',24,87],['bytes=24-',24,bytes.length-1],['bytes=-27',bytes.length-27,bytes.length-1],[`bytes=${bytes.length-1}-${bytes.length-1}`,bytes.length-1,bytes.length-1],['bytes= 0-1 ',0,1]];
 for(const [range,start,end] of cases){
  const response=await f.get(range);assert.equal(response.status,206,range);
  assert.equal(response.headers.get('content-type'),'video/mp4');assert.equal(response.headers.get('accept-ranges'),'bytes');
  assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${bytes.length}`);
  assert.equal(response.headers.get('content-length'),String(end-start+1));assert.deepEqual(await body(response),bytes.subarray(start,end+1));
 }
});

test('MP4 clips oversized ends and suffixes without integer overflow',async t=>{
 const f=await fixture(t);
 for(const range of ['bytes=0-99999999999999999999999999999999999999','bytes=-99999999999999999999999999999999999999']){
  const response=await f.get(range);assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes 0-${bytes.length-1}/${bytes.length}`);
  assert.equal(response.headers.get('content-length'),String(bytes.length));assert.deepEqual(await body(response),bytes);
 }
});

test('MP4 valid unsatisfiable ranges return 416 with total length and an empty body',async t=>{
 const f=await fixture(t);
 for(const range of [`bytes=${bytes.length}-`,`bytes=${bytes.length+1}-${bytes.length+20}`,'bytes=99999999999999999999999999999999999999-','bytes=-0']){
  const response=await f.get(range);assert.equal(response.status,416,range);
  assert.equal(response.headers.get('content-range'),`bytes */${bytes.length}`);assert.equal(response.headers.get('accept-ranges'),'bytes');
  assert.equal(response.headers.get('content-length'),'0');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await body(response)).length,0);
 }
});

test('MP4 ignores malformed, multipart, unknown-unit and excessive Range fields',async t=>{
 const f=await fixture(t);
 for(const range of ['bytes=','bytes=-','bytes=5-2','bytes=abc-def','bytes=1.2-4','bytes=0-1,5-6','items=0-1',`bytes=0-${'9'.repeat(300)}`]){
  const response=await f.get(range);assert.equal(response.status,200,range);assert.equal(response.headers.get('content-range'),null);
  assert.equal(response.headers.get('content-length'),String(bytes.length));assert.deepEqual(await body(response),bytes);
 }
});

test('MP4 If-Range receives the complete representation when no matching validator exists',async t=>{
 const f=await fixture(t);const response=await f.get('bytes=0-1',{headers:{'If-Range':'"older-release"'}});
 assert.equal(response.status,200);assert.equal(response.headers.get('content-range'),null);assert.deepEqual(await body(response),bytes);
});

test('MP4 empty/missing resources and non-video static files retain correct behavior',async t=>{
 const f=await fixture(t);
 const empty=await fetch(`${f.base}/media/empty.mp4`,{headers:{Range:'bytes=0-1'}});
 assert.equal(empty.status,200);assert.equal(empty.headers.get('content-length'),'0');assert.equal((await body(empty)).length,0);
 assert.equal((await fetch(`${f.base}/media/missing.mp4`)).status,404);
 assert.equal((await f.get(undefined,{method:'POST'})).status,405);
 const image=await fetch(`${f.base}/media/poster.webp`,{headers:{Range:'bytes=0-1'}});
 assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/webp');assert.equal(image.headers.get('accept-ranges'),null);
 assert.equal(await image.text(),'poster fixture');
});
