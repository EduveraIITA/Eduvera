import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const baseline=JSON.parse(readFileSync(new URL('./showcase-baseline.json',import.meta.url)));
const source=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
test('live product showcase source, timing, stylesheet and every screenshot remain byte-identical',()=>{
 for(const [name,expected] of Object.entries(baseline.components)){
  const start=source.indexOf('function '+name+'(');let end=source.indexOf('\nfunction ',start+1);
  if(end<0)end=source.indexOf('\nexport function App',start);
  assert.equal(hash(source.slice(start,end)),expected,name);
 }
 for(const [path,expected] of Object.entries(baseline.files))assert.equal(hash(readFileSync(new URL('../'+path,import.meta.url))),expected,path);
});
