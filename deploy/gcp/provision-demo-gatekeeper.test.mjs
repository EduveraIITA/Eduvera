import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, privateDecrypt, constants, createDecipheriv, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { credentialHash, containerProgram, createInsideContainer, encryptCredentials, provision } from './provision-demo-gatekeeper.mjs';

test('password hashing matches the application scrypt contract', () => {
  const password = 'Synthetic!Password12345';
  const [algorithm,n,r,p,salt,hash] = credentialHash(password).split('$');
  assert.equal(algorithm,'scrypt');assert.equal(n,'32768');assert.equal(r,'8');assert.equal(p,'1');
  assert.equal(scryptSync(password,Buffer.from(salt,'base64url'),64,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('base64url'),hash);
  const encoded = containerProgram(credentialHash(password),'12345678-1234-1234-1234-123456789abc');
  assert(!encoded.includes(','));assert(!encoded.includes(password));
  assert.throws(()=>containerProgram(password,'12345678-1234-1234-1234-123456789abc'));
});

test('only the private recipient can recover the runner-generated credential', () => {
  const pair = generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  const packet = {username:'gate.demo',password:'Synthetic!Password12345',operation_id:'12345678-1234-1234-1234-123456789abc'};
  const encoded = encryptCredentials(packet,pair.publicKey);
  assert(!encoded.includes(packet.password));
  const envelope = JSON.parse(Buffer.from(encoded,'base64').toString());
  const key = privateDecrypt({key:pair.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope.wrapped_key,'base64'));
  const cipher = createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));cipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
  assert.deepEqual(JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext,'base64')),cipher.final()]).toString()),packet);
});

test('unapproved cloud execution is rejected before any cloud call', async () => {
  let called=false;await assert.rejects(provision({},()=>{called=true;}));assert.equal(called,false);
});

test('invalid credential material is rejected before opening a database', async () => {
  let called=false;await assert.rejects(createInsideContainer('plaintext','12345678-1234-1234-1234-123456789abc',{connect(){called=true;}}));assert.equal(called,false);
});

test('the bounded new-account operation cannot update existing users or target Kavita', () => {
  const body=createInsideContainer.toString();
  assert(!/UPDATE\s+users/i.test(body));assert(!body.includes('kavita.staff'));
  assert(body.includes("username='gate.demo'"));assert(body.includes('ROLLBACK'));
  const workflow=readFileSync(new URL('../../.github/workflows/google-cloud-stage.yml',import.meta.url),'utf8');
  assert(workflow.includes('[new-gate-demo]'));assert(workflow.includes("CREATE_NEW_GATE_DEMO: 'true'"));
  assert(!readFileSync(new URL('./provision-demo-gatekeeper.mjs',import.meta.url),'utf8').includes("'logging', 'read'"));
});
