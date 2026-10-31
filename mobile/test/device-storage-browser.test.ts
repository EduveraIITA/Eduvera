import assert from 'node:assert/strict';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createBrowserDeviceStorage } from '../src/lib/device-storage-browser';
import { createChunkedNativePendingStorage } from '../src/lib/native-pending-action';
import { simulationBaselineIntentValid, type SimulationBaselineIntent } from '../src/features/SimulationBaselinePolicy';
import { simulationRemovalIntentValid, type SimulationRemovalIntent } from '../src/features/SimulationRemovalPolicy';

const crypto = webcrypto as unknown as Crypto;
const key = `thatcampus.pending.v1.messages.${'a'.repeat(64)}`;
const other = `thatcampus.pending.v1.messages.${'b'.repeat(64)}`;
const databaseName = 'thatcampus-device-journals-v1';
const store = 'journal_entries', keys = 'encryption_keys';
const storage = (indexedDB = new IDBFactory()) => ({ indexedDB, journal: createBrowserDeviceStorage({ indexedDB: () => indexedDB, crypto: () => crypto }) });
async function database(factory: IDBFactory) {
  return new Promise<IDBDatabase>((resolve, reject) => { const request = factory.open(databaseName, 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
async function raw<T>(factory: IDBFactory, target: string, work: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await database(factory);
  try { return await new Promise<T>((resolve, reject) => { const transaction = db.transaction(target, 'readwrite'), request = work(transaction.objectStore(target)); let value: T; request.onsuccess = () => { value = request.result; }; transaction.oncomplete = () => resolve(value!); transaction.onabort = transaction.onerror = () => reject(transaction.error); }); }
  finally { db.close(); }
}

test('browser journals round-trip exact UTF-8 across a new adapter without plaintext storage', async () => {
  const { indexedDB, journal } = storage(), text = JSON.stringify({ body: 'कक्षा 🙂\nexact request', phase: 'unknown' });
  assert.equal(await journal.getItemAsync(key), null);
  await journal.setItemAsync(key, text, { keychainAccessible: 6 });
  assert.equal(await createBrowserDeviceStorage({ indexedDB: () => indexedDB, crypto: () => crypto }).getItemAsync(key), text);
  const envelope = await raw(indexedDB, store, store => store.get(key));
  assert.equal(envelope.version, 1); assert.equal(envelope.iv.byteLength, 12); assert.ok(envelope.ciphertext instanceof ArrayBuffer);
  assert.ok(!JSON.stringify(envelope).includes('exact request'));
  const secret = await raw(indexedDB, keys, store => store.get('journal-aes-gcm-v1'));
  assert.equal(secret.extractable, false); await assert.rejects(crypto.subtle.exportKey('raw', secret));
  await journal.deleteItemAsync(key); assert.equal(await journal.getItemAsync(key), null);
});

test('Calendar, Schedule, Attendance and Gate use the same encrypted, scope-bound browser journals', async () => {
  const { indexedDB, journal } = storage();
  for (const domain of ['calendar','schedule','attendance','gate']) {
    const exactKey = `thatcampus.pending.v1.${domain}.${'c'.repeat(64)}`;
    await journal.setItemAsync(exactKey, `original ${domain} command`);
    assert.equal(await createBrowserDeviceStorage({ indexedDB: () => indexedDB, crypto: () => crypto }).getItemAsync(exactKey), `original ${domain} command`);
    const envelope = await raw(indexedDB,store,store => store.get(exactKey));
    assert.equal(envelope.version,1); assert.ok(envelope.ciphertext instanceof ArrayBuffer);
    await journal.deleteItemAsync(exactKey);
  }
  await assert.rejects(journal.setItemAsync(`thatcampus.pending.v1.arbitrary.${'c'.repeat(64)}`, 'outside namespace'), /only scope-bound/);
});

test('Simulation baseline and removal recover exact encrypted chunk journals across a new adapter', async () => {
  const { indexedDB, journal } = storage(), schoolId=randomUUID(), scope='actor:school:live:server', digest=(value:string)=>Promise.resolve(createHash('sha256').update(value).digest('hex'));
  const suffix=await digest(scope), runId=randomUUID(), scenarioId=randomUUID();
  const baseline:SimulationBaselineIntent={version:1,scope,schoolId,captureId:randomUUID(),runId,scenarioId,name:'Campus renderer review',speed:1,end_at:null,fingerprint:'original-captured-source',phase:'start_submitted'};
  const removal:SimulationRemovalIntent={version:1,scope,schoolId,runId,scenarioId,name:'Campus renderer review',draft:false,reviewedRevision:4,removalRevision:4,phase:'reconcile',submitted:true};
  const chunked=(namespace:string,adapter=journal)=>createChunkedNativePendingStorage({get:adapter.getItemAsync,set:adapter.setItemAsync,remove:adapter.deleteItemAsync,randomId:randomUUID,digest},`thatcampus.${namespace}.${suffix}`);
  for(const [namespace,intent,valid]of[
    ['simulation-baseline',baseline,simulationBaselineIntentValid],['simulation-removal',removal,simulationRemovalIntentValid],
  ]as const){
    const prefix=`thatcampus.${namespace}.${suffix}`,original=JSON.stringify(intent);
    assert.equal(await chunked(namespace).read(),null);
    await chunked(namespace).write(original);
    const restored=createBrowserDeviceStorage({indexedDB:()=>indexedDB,crypto:()=>crypto});
    const retained=await chunked(namespace,restored).read();assert.equal(retained,original);
    assert.equal(valid(JSON.parse(retained!),scope,schoolId),true);
    assert.equal(valid(JSON.parse(retained!),`${scope}:another-world`,schoolId),false);
    const ownedKeys=(await raw(indexedDB,store,entry=>entry.getAllKeys())).filter(key=>typeof key==='string'&&key.startsWith(`${prefix}.`));
    assert.ok(ownedKeys.some(key=>key===`${prefix}.manifest`));assert.ok(ownedKeys.length>=2);
    for(const key of ownedKeys){const envelope=await raw(indexedDB,store,entry=>entry.get(key));assert.equal(envelope.version,1);assert.equal(envelope.iv.byteLength,12);assert.ok(envelope.ciphertext instanceof ArrayBuffer);assert.equal(Buffer.from(envelope.ciphertext).includes(Buffer.from(intent.name)),false);}
  }
  await chunked('simulation-baseline').clear();assert.equal(await chunked('simulation-baseline').read(),null);
  assert.equal(await chunked('simulation-removal').read(),JSON.stringify(removal),'clearing a baseline cannot clear a separate removal receipt');
  await chunked('simulation-removal').clear();assert.equal(await chunked('simulation-removal').read(),null);
  assert.equal(await raw(indexedDB,store,entry=>entry.count()),0);
});

test('Simulation journal ciphertext cannot be transplanted to another follow-up namespace or scope', async () => {
  const {indexedDB,journal}=storage(),suffix='c'.repeat(64),source=`thatcampus.simulation-baseline.${suffix}.manifest`;
  const retained=JSON.stringify({phase:'start_submitted',runId:randomUUID()});await journal.setItemAsync(source,retained);
  const envelope=await raw(indexedDB,store,entry=>entry.get(source));
  for(const target of [`thatcampus.simulation-removal.${suffix}.manifest`,`thatcampus.simulation-baseline.${'d'.repeat(64)}.manifest`]){
    await raw(indexedDB,store,entry=>entry.put(envelope,target));
    await assert.rejects(createBrowserDeviceStorage({indexedDB:()=>indexedDB,crypto:()=>crypto}).getItemAsync(target),/could not be verified/);
    assert.deepEqual(await raw(indexedDB,store,entry=>entry.get(target)),envelope,'unverified ciphertext is retained for recovery');
  }
  assert.equal(await journal.getItemAsync(source),retained);
});

test('Simulation allowlist additions retain hashed scope, exact namespace and credential denials',async()=>{
  const{journal}=storage(),suffix='a'.repeat(64);
  for(const rejected of[
    'thatcampus.simulation-baseline',`thatcampus.simulation-baseline.account`,`thatcampus.simulation.baseline.${suffix}`,
    `thatcampus.simulation-credentials.${suffix}`,`thatcampus.simulation-removal.${suffix}.access-token`,
    `thatcampus.simulation-baseline.${suffix}.manifest.extra`,`thatcampus.simulation-baseline.${suffix}.${randomUUID()}.10000`,
    `thatcampus.session.${suffix}`,'bearer','thatcampus.access-token',
  ]){
    await assert.rejects(journal.getItemAsync(rejected),/only scope-bound/);
    await assert.rejects(journal.setItemAsync(rejected,'credential'),/only scope-bound/);
    await assert.rejects(journal.deleteItemAsync(rejected),/only scope-bound/);
  }
  await assert.rejects(journal.setItemAsync(`thatcampus.simulation-baseline.${suffix}`,'intent',{requireAuthentication:true}),/unavailable/);
  assert.equal(await journal.getItemAsync(`thatcampus.simulation-baseline.${suffix}`),null);
});

test('ciphertext is bound to the exact journal key and cannot be substituted between scopes', async () => {
  const { indexedDB, journal } = storage(); await journal.setItemAsync(key, 'original unknown body');
  const envelope = await raw(indexedDB, store, store => store.get(key)); await raw(indexedDB, store, store => store.put(envelope, other));
  await assert.rejects(journal.getItemAsync(other), /could not be verified/);
  assert.equal(await journal.getItemAsync(key), 'original unknown body');
  assert.deepEqual(await raw(indexedDB, store, store => store.get(other)), envelope);
});

test('missing, malformed and corrupted retained encryption data fail closed without replacement', async () => {
  const { indexedDB, journal } = storage(); await journal.setItemAsync(key, 'keep this exact action');
  const envelope = await raw(indexedDB, store, store => store.get(key));
  const damaged = { ...envelope, ciphertext: envelope.ciphertext.slice(0) }; new Uint8Array(damaged.ciphertext)[0] ^= 1;
  await raw(indexedDB, store, store => store.put(damaged, key));
  await assert.rejects(journal.getItemAsync(key), /could not be verified/);
  await raw(indexedDB, store, store => store.put('unexpected plaintext', key));
  await assert.rejects(journal.getItemAsync(key), /could not be verified/);
  assert.equal(await raw(indexedDB, store, store => store.get(key)), 'unexpected plaintext');
  await raw(indexedDB, store, store => store.put(envelope, key));
  await raw(indexedDB, keys, store => store.delete('journal-aes-gcm-v1'));
  await assert.rejects(journal.getItemAsync(key), /could not be verified/);
  await assert.rejects(journal.setItemAsync(other, 'must not replace the missing key'), /could not be verified/);
  assert.equal(await raw(indexedDB, keys, store => store.get('journal-aes-gcm-v1')), undefined);
  assert.equal(await raw(indexedDB, store, store => store.get(other)), undefined);
  await raw(indexedDB, keys, store => store.put({}, 'journal-aes-gcm-v1'));
  await assert.rejects(journal.getItemAsync(key), /could not be verified/);
  assert.deepEqual(await raw(indexedDB, store, store => store.get(key)), envelope);
});

test('storage denial, unavailable crypto and unsupported native auth never use a fallback', async () => {
  const denied = createBrowserDeviceStorage({ indexedDB: () => { throw new Error('denied'); }, crypto: () => crypto });
  await assert.rejects(denied.getItemAsync(key), /unavailable/); await assert.rejects(denied.setItemAsync(key, 'body'), /unavailable/); await assert.rejects(denied.deleteItemAsync(key), /unavailable/);
  const { indexedDB } = storage(), noCrypto = createBrowserDeviceStorage({ indexedDB: () => indexedDB, crypto: () => undefined });
  await assert.rejects(noCrypto.setItemAsync(key, 'body'), /unavailable/);
  const journal = createBrowserDeviceStorage({ indexedDB: () => indexedDB, crypto: () => crypto });
  await assert.rejects(journal.setItemAsync(key, 'body', { requireAuthentication: true }), /unavailable/);
  await assert.rejects(journal.setItemAsync(key, 'body', { keychainService: 'other' }), /unavailable/);
  for (const credential of ['thatcampus.session', 'bearer', 'thatcampus.access-token', 'thatcampus.attendance.database-key']) await assert.rejects(journal.setItemAsync(credential, 'credential'), /only scope-bound/);
  await assert.rejects(journal.setItemAsync(key, {} as string), /must be strings/);
  assert.equal(await journal.getItemAsync(key), null);
});

test('concurrent first writes retain one nonextractable key and both exact scoped values', async () => {
  const indexedDB = new IDBFactory(), first = createBrowserDeviceStorage({ indexedDB: () => indexedDB, crypto: () => crypto }), second = createBrowserDeviceStorage({ indexedDB: () => indexedDB, crypto: () => crypto });
  await Promise.all([first.setItemAsync(key, 'first'), second.setItemAsync(other, 'second')]);
  assert.equal(await second.getItemAsync(key), 'first'); assert.equal(await first.getItemAsync(other), 'second');
  assert.equal(await raw(indexedDB, keys, store => store.count()), 1);
});

function abortAfterRequest(factory: IDBFactory, method: 'put' | 'delete'): IDBFactory {
  return { open(name: string, version?: number) {
    const request = factory.open(name, version);
    request.addEventListener('success', () => {
      const db = request.result, transaction = db.transaction.bind(db);
      db.transaction = ((names: string | Iterable<string>, mode?: IDBTransactionMode, options?: IDBTransactionOptions) => {
        const tx = transaction(names, mode, options);
        if (mode === 'readwrite' && (typeof names === 'string' ? names === store : [...names].length === 1 && [...names][0] === store)) {
          const objectStore = tx.objectStore(store), operation = objectStore[method].bind(objectStore);
          Object.defineProperty(objectStore, method, { value: (...args: unknown[]) => { const result = Reflect.apply(operation, objectStore, args); result.addEventListener('success', () => tx.abort()); return result; } });
        }
        return tx;
      }) as IDBDatabase['transaction'];
    });
    return request;
  } } as IDBFactory;
}

test('request success followed by transaction abort never confirms a write or deletion', async () => {
  const { indexedDB, journal } = storage(); await journal.setItemAsync(key, 'last committed request');
  const abortedWrite = createBrowserDeviceStorage({ indexedDB: () => abortAfterRequest(indexedDB, 'put'), crypto: () => crypto });
  await assert.rejects(abortedWrite.setItemAsync(key, 'uncommitted replacement'), /unavailable/);
  assert.equal(await journal.getItemAsync(key), 'last committed request');
  const abortedDelete = createBrowserDeviceStorage({ indexedDB: () => abortAfterRequest(indexedDB, 'delete'), crypto: () => crypto });
  await assert.rejects(abortedDelete.deleteItemAsync(key), /unavailable/);
  assert.equal(await journal.getItemAsync(key), 'last committed request');
});

test('existing immutable chunk and manifest journal keeps the original exact bytes in browser storage', async () => {
  const { journal } = storage(), digest = (value: string) => Promise.resolve(createHash('sha256').update(value).digest('hex'));
  const chunks = () => createChunkedNativePendingStorage({ get: journal.getItemAsync, set: journal.setItemAsync, remove: journal.deleteItemAsync, randomId: randomUUID, digest }, key);
  const original = JSON.stringify({ phase: 'unknown', body: '🙂'.repeat(700) });
  await chunks().write(original); assert.equal(await chunks().read(), original);
  await chunks().write('accepted result'); assert.equal(await chunks().read(), 'accepted result');
  await chunks().clear(); assert.equal(await chunks().read(), null);
});
