import assert from 'node:assert/strict';
import test from 'node:test';
import { createCampusApiClient } from '../src/lib/api-client';
import { createBrowserDownloadAdapter } from '../src/lib/browser-private-download';

function environment(onCreate?: () => void, clickFailure = false) {
  const blobs = new Map<string, Blob>(), revoked: string[] = [], scheduled: Array<() => void> = [], links: Array<{ href: string; download: string; removed: boolean }> = [];
  const document = { body: { appendChild() {} }, createElement() { const link = { href: '', download: '', rel: '', removed: false, click() { if (clickFailure) throw new Error('download denied'); links.push(link); }, remove() { link.removed = true; } }; return link; } } as unknown as Pick<Document, 'createElement' | 'body'>;
  const adapter = createBrowserDownloadAdapter({ document: () => document, createObjectURL(blob) { const uri = `blob:private-${blobs.size + 1}`; blobs.set(uri, blob); onCreate?.(); return uri; }, revokeObjectURL(uri) { revoked.push(uri); blobs.delete(uri); }, schedule(work) { scheduled.push(work); } });
  return { adapter, blobs, revoked, scheduled, links };
}
const pdf = new TextEncoder().encode('%PDF-1.7\nprivate exact file');
function client(response: () => Response, maximum = 1024) { const calls: Array<{ url: string; init?: RequestInit }> = []; const api = createCampusApiClient({ origin: 'https://campus.example', development: false, maxDownloadBytes: maximum, cookieSession: { readCsrfToken: () => 'csrf' }, fetcher: async (url, init) => { calls.push({ url: String(url), init }); return response(); } }); api.bindCookieSession('simulation:run-a'); return { api, calls }; }

test('browser private downloads retain bounded bytes, cookie/world transport and deferred Blob cleanup', async () => {
  const { api, calls } = client(() => new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } })), state = environment();
  await api.downloadCampusFile('/api/v1/files/exact', 'report.pdf', state.adapter);
  assert.equal(calls.length, 1); assert.equal(calls[0]!.init?.method, 'GET'); assert.equal(calls[0]!.init?.credentials, 'same-origin'); assert.equal(new Headers(calls[0]!.init?.headers).get('Authorization'), null);
  assert.equal(state.links.length, 1); assert.equal(state.links[0]!.download, 'report.pdf'); assert.equal(state.links[0]!.removed, true);
  assert.deepEqual(new Uint8Array(await [...state.blobs.values()][0]!.arrayBuffer()), pdf);
  assert.equal(state.revoked.length, 0); assert.equal(state.scheduled.length, 1); state.scheduled[0]!(); assert.equal(state.blobs.size, 0); assert.equal(state.revoked.length, 1);
});

test('omitted Simulation originals, HTML and over-limit responses never create or present a browser file', async () => {
  const responses = [() => new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'x-thatcampus-source-content-omitted': 'true' } }), () => new Response('<!DOCTYPE html><html>login</html>', { headers: { 'Content-Type': 'text/html' } }), () => new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Length': '5000' } })];
  for (const response of responses) { const { api } = client(response), state = environment(); await assert.rejects(api.downloadCampusFile('/api/v1/files/exact', 'report.pdf', state.adapter)); assert.equal(state.blobs.size, 0); assert.equal(state.links.length, 0); }
});

test('a context rebind after Blob creation prevents presentation and immediately revokes its URL', async () => {
  const { api } = client(() => new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } })), state = environment(() => api.bindCookieSession('simulation:other'));
  await assert.rejects(api.downloadCampusFile('/api/v1/files/exact', 'report.pdf', state.adapter), /context changed/);
  assert.equal(state.links.length, 0); assert.equal(state.blobs.size, 0); assert.equal(state.revoked.length, 1); assert.equal(state.scheduled.length, 0);
});

test('browser presentation failure releases the temporary bytes without recording a successful download', async () => {
  const { api } = client(() => new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } })), state = environment(undefined, true);
  await assert.rejects(api.downloadCampusFile('/api/v1/files/exact', 'report.pdf', state.adapter), /download denied/);
  assert.equal(state.links.length, 0); assert.equal(state.blobs.size, 0); assert.equal(state.revoked.length, 1);
});
