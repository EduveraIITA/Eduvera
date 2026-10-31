import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {createVisitJoinContinuations} from '../src/auth/visit-join-continuation';
import * as policy from '../src/auth/visit-join-policy';
import {createGoogleNativeReturnRegistry} from '../src/auth/google-native-flow';
test('the real native URL hook scrubs invitations into an origin-bound volatile nonce and preserves Google handling',()=>{
 const vault=createVisitJoinContinuations(),returns=createGoogleNativeReturnRegistry(),token='V'.repeat(43),origin='https://campus.example';let serial=0;
 const exports:any={},dependencies:any={'../src/auth/google-native-flow':{googleNativeReturns:returns},'expo-crypto':{randomUUID:()=>`10000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`},'../src/lib/api':{getApiOrigin:()=>origin},'../src/auth/visit-join-continuation':{visitJoinContinuations:vault},'../src/auth/visit-join-policy':policy};
 const source=ts.transpileModule(readFileSync(new URL('../app/+native-intent.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(source,{exports,require:(name:string)=>{assert.ok(name in dependencies,name);return dependencies[name];}});
 for(const initial of [true,false]){
  const target=exports.redirectSystemPath({path:`thatcampus:///visit-join#token=${token}`,initial});assert.ok(policy.visitJoinReturnTarget(target));assert.equal(target.includes(token),false);assert.equal(vault.resolve(target,origin)?.token,token);assert.equal(vault.resolve(target,'https://other.example'),null);
  assert.equal(exports.redirectSystemPath({path:target,initial}),target);
 }
 for(const path of [`thatcampus:///visit-join?token=${token}`,`thatcampus:///visit-join?token=${token}#token=${token}`,'thatcampus:///visit-join#token=short'])assert.equal(exports.redirectSystemPath({path,initial:false}),'/visit-join');
 assert.equal(exports.redirectSystemPath({path:'thatcampus://auth/google?code=untrusted',initial:true}),'/login?google_return=expired');
 assert.equal(exports.redirectSystemPath({path:'/areas/in-out',initial:false}),'/areas/in-out');
});
