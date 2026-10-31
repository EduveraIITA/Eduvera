import test from 'node:test';
import assert from 'node:assert/strict';
import { installFormDataPatch } from '../node_modules/expo/src/winter/FormData';
import { convertFormDataAsync } from '../node_modules/expo/src/winter/fetch/convertFormData';
import { nativePendingUploadForm, type NativePendingPayload } from '../src/lib/native-pending-action';

const payload: Extract<NativePendingPayload, { kind: 'multipart' }> = { kind: 'multipart', fields: { client_id: 'original-command', body: 'Original caption' }, file: { uri: 'file:///private/pending/original', name: 'evidence.pdf', type: 'application/pdf', size: 5, hash: 'a'.repeat(64) } };
class NativeFormDataFixture { _parts: [string, unknown][] = []; }
installFormDataPatch(NativeFormDataFixture as unknown as typeof FormData);
const createForm = () => new NativeFormDataFixture() as unknown as FormData;

test('installed Expo multipart converter accepts verified byte parts without RN binary Blob support', async () => {
  const original = globalThis.Blob;
  let encoded: Awaited<ReturnType<typeof convertFormDataAsync>>;
  try {
    // RN0.88 rejects Blob(ArrayBuffer/View). Exercise the actual Expo converter.
    globalThis.Blob = class UnsupportedBinaryBlob { constructor() { throw new Error('RN cannot construct a binary Blob'); } } as unknown as typeof Blob;
    const input = new Uint8Array([37, 80, 68, 70, 10]);
    const data = nativePendingUploadForm(payload, input, createForm);
    input.fill(0);
    encoded = await convertFormDataAsync(data, 'NativeBoundary');
  } finally { globalThis.Blob = original; }
  const request = new Request('https://campus.example/api/v1/chat/conversations/original/messages/', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${encoded.boundary}` }, body: new Uint8Array(encoded.body).buffer });
  const wire = await request.formData() as unknown as { get(name: string): string | Blob | null };
  assert.equal(wire.get('client_id'), 'original-command');
  assert.equal(wire.get('body'), 'Original caption');
  const file = wire.get('file') as File;
  assert.equal(file.name, 'evidence.pdf');
  assert.equal(file.type, 'application/pdf');
  assert.equal(await file.text(), '%PDF\n');
});
test('a size mismatch cannot produce an upload form', () => {
  assert.throws(() => nativePendingUploadForm(payload, new Uint8Array([1]), createForm), /size changed/);
});
