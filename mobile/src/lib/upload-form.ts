type Upload = { fields: Record<string, string>; file: { name: string; type: string; size: number } };
/** Preserve Expo's verified-byte multipart interface on native platforms. */
export function privateUploadForm(payload: Upload, bytes: Uint8Array, createForm: () => FormData = () => new FormData(), partName = 'file'): FormData {
  if (bytes.byteLength !== payload.file.size) throw new Error('The retained upload size changed. Nothing was sent.');
  const form = createForm(), original = new Uint8Array(bytes);
  for (const [key, value] of Object.entries(payload.fields)) form.append(key, value);
  const part = Object.freeze({ name: payload.file.name, type: payload.file.type, size: original.byteLength, bytes: async () => new Uint8Array(original) });
  (form.append as unknown as (name: string, value: typeof part) => void).call(form, partName, part);
  return form;
}
