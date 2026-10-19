import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

test('dark wordmark renders with transparent padding and retains white and blue ink',async()=>{
 const {data,info}=await sharp(new URL('../public/thatcampus-logo-dark-transparent.svg',import.meta.url).pathname).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let white=0,blue=0,transparent=0;
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
  const i=(y*info.width+x)*4;const [r,g,b,a]=data.subarray(i,i+4);
  if(x<4||y<4||x>=info.width-4||y>=info.height-4)assert.equal(a,0,`opaque padding at ${x},${y}`);
  if(a===0)transparent++;
  if(a>240&&r>240&&g>240&&b>240)white++;
  if(a>240&&b>200&&b>r*2)blue++;
 }
 assert(transparent>info.width*info.height*.5,'background must be transparent');
 assert(white>5000,'white That lettering must remain visible');
 assert(blue>5000,'blue Campus and rays must remain visible');
});
