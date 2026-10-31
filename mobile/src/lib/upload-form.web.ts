type Upload = { fields: Record<string, string>; file: { name: string; type: string; size: number } };
/** Browsers require a real Blob/File part; never append an Expo URI/object part. */
export function privateUploadForm(payload: Upload, bytes: Uint8Array, createForm: () => FormData = () => new FormData(), partName = 'file'): FormData {
  if (bytes.byteLength !== payload.file.size) throw new Error('The retained upload size changed. Nothing was sent.');
  const form = createForm();
  for (const [key, value] of Object.entries(payload.fields)) form.append(key, value);
  form.append(partName, new Blob([new Uint8Array(bytes).buffer], { type: payload.file.type }), payload.file.name);
  return form;
}
