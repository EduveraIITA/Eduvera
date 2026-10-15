import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexNowPayload,indexNowUrls,submitIndexNow} from '../indexnow.mjs';

test('IndexNow submits only canonical public URLs with a hosted verification key', async () => {
  assert.equal(indexNowPayload.host, 'thatcampus.com');
  assert.match(indexNowPayload.key, /^[a-f0-9]{32}$/);
  assert.equal(indexNowPayload.keyLocation, `https://thatcampus.com/${indexNowPayload.key}.txt`);
  assert.equal(indexNowUrls.length, 8);
  assert(indexNowUrls.every(url => url.startsWith('https://thatcampus.com/')));
  assert.equal(new Set(indexNowUrls).size, indexNowUrls.length);

  let submitted;
  const status = await submitIndexNow(async (url, options) => {
    submitted = {url, options};
    return {status: 202};
  });
  assert.equal(status, 202);
  assert.equal(submitted.url, 'https://api.indexnow.org/indexnow');
  assert.deepEqual(JSON.parse(submitted.options.body), indexNowPayload);
});

test('IndexNow rejection is observable without weakening release verification', async () => {
  await assert.rejects(
    submitIndexNow(async () => ({status: 429})),
    /HTTP 429/,
  );
});
