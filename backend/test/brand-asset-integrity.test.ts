import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '..');
const file = (path: string) => readFileSync(resolve(root, path));
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
interface Asset { path: string; width: number; height: number; alpha: boolean; sha256: string; surface: string }
const inventory = JSON.parse(file('design/brand/asset-manifest-v3.json').toString()) as {
  assets: Asset[]; metadata_files: Array<{ path: string; sha256: string }>;
  compatibility_files: Array<{ path: string; format: string; sha256: string }>;
  sources: Array<{ variant: string; source_sha256: string }>;
};

function alphaRange(bytes: Buffer) {
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(bytes[24]).toBe(8); expect(bytes[25]).toBe(6); expect(bytes[28]).toBe(0);
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), idat: Buffer[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const packed = inflateSync(Buffer.concat(idat)), stride = width * 4;
  expect(packed.length).toBe((stride + 1) * height);
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = packed[y * (stride + 1)]!; expect(filter).toBeLessThanOrEqual(4);
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[y * stride + x - 4]! : 0;
      const up = y ? pixels[(y - 1) * stride + x]! : 0;
      const corner = y && x >= 4 ? pixels[(y - 1) * stride + x - 4]! : 0;
      const prediction = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, corner)][filter]!;
      pixels[y * stride + x] = (packed[y * (stride + 1) + 1 + x]! + prediction) & 255;
    }
  }
  let clear = 0, opaque = 0, soft = 0;
  for (let p = 3; p < pixels.length; p += 4) {
    if (pixels[p] === 0) clear++; else if (pixels[p] === 255) opaque++; else soft++;
  }
  const corners = [0, width - 1, (height - 1) * width, width * height - 1]
    .map(corner => Array.from(pixels.subarray(corner * 4, corner * 4 + 4)));
  return { width, height, clear, opaque, soft, corners };
}

describe('owner-supplied brand assets and readable install tiles', () => {
  it('keeps exact source provenance and separately hashes every public branding asset and metadata file', () => {
    for (const source of inventory.sources) expect(sha(file(`design/brand/source/thatcampus-${source.variant}.jpg`))).toBe(source.source_sha256);
    for (const asset of [...inventory.assets, ...inventory.metadata_files, ...inventory.compatibility_files]) expect(sha(file(asset.path)), asset.path).toBe(asset.sha256);
    expect(inventory.compatibility_files).toHaveLength(11);
    expect(inventory.compatibility_files[0]?.format).toBe('jpeg');
    expect(file('frontend/public/assets/thatcampus-logo.jpg').subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
  });

  it('contains actual clear alpha, opaque artwork and antialiased edges, not a painted background', () => {
    expect(inventory.assets).toHaveLength(31);
    const transparentAssets = inventory.assets.filter(asset => asset.surface === 'transparent');
    expect(transparentAssets).toHaveLength(20);
    for (const asset of transparentAssets) {
      const image = alphaRange(file(asset.path));
      expect(asset.alpha, asset.path).toBe(true);
      expect([image.width, image.height], asset.path).toEqual([asset.width, asset.height]);
      expect(image.clear, asset.path).toBeGreaterThan(image.width * image.height * 0.1);
      expect(image.opaque, asset.path).toBeGreaterThan(50);
      expect(image.soft, asset.path).toBeGreaterThan(0);
      for (const corner of image.corners) expect(corner[3], asset.path).toBe(0);
    }
    const light = inventory.assets.find(asset => asset.path === 'frontend/public/assets/thatcampus-wordmark-light-v3.png');
    const dark = inventory.assets.find(asset => asset.path === 'frontend/public/assets/thatcampus-wordmark-dark-v3.png');
    if (!light || !dark) throw new Error('Both supplied wordmarks must be present.');
    expect([light.width, light.height]).toEqual([dark.width, dark.height]);
    // Install correction must never silently alter the approved transparent originals.
    expect(light.sha256).toBe('38c90d936b6ed18e33862c70887d5e1bc227b4b38f756303dade213e084508f2');
    expect(dark.sha256).toBe('d3352b6e857087053c341c1278d604f6e8b8e47f8b1657506bc381b566159770');
  });

  it('bakes the install background into every pixel, including compatibility aliases', () => {
    const opaqueAssets = inventory.assets.filter(asset => asset.surface !== 'transparent');
    expect(opaqueAssets).toHaveLength(11);
    for (const asset of opaqueAssets) {
      expect(asset.surface).toBe('#111318');
      const image = alphaRange(file(asset.path));
      expect([image.width, image.height], asset.path).toEqual([asset.width, asset.height]);
      expect(image.clear, asset.path).toBe(0);
      expect(image.soft, asset.path).toBe(0);
      expect(image.opaque, asset.path).toBe(image.width * image.height);
      for (const corner of image.corners) expect(corner, asset.path).toEqual([17, 19, 24, 255]);
    }
    for (const [alias, versioned] of [
      ['apple-touch-icon.png', 'touch'], ['apple-touch-icon-edura.png', 'touch'], ['icon-192.png', 'icon-192'], ['icon-512.png', 'icon-512'],
      ['icons/edura-leaf-192.png', 'icon-192'], ['icons/edura-leaf-512.png', 'icon-512'],
      ['icons/eduvera-192.png', 'icon-192'], ['icons/eduvera-512.png', 'icon-512'],
    ]) expect(file(`frontend/public/${alias}`)).toEqual(file(`frontend/public/icons/thatcampus-${versioned}-v4.png`));
    expect(file('frontend/public/edura-leaf-favicon.png')).toEqual(file('frontend/public/icons/thatcampus-favicon-light-v3.png'));
    expect(file('backend/assets/receipt/thatcampus-logo.png')).toEqual(file('backend/assets/receipt/thatcampus-wordmark-light-v3.png'));
  });

  it('preserves one install identity and the same correctly sized opaque icons in every manifest', () => {
    const baseline = JSON.parse(file('frontend/public/manifest.webmanifest').toString());
    for (const path of ['manifest.webmanifest', 'icons/manifest-v4.webmanifest',
      'icons/manifest-light-v3.webmanifest', 'icons/manifest-dark-v3.webmanifest']) {
      const manifest = JSON.parse(file(`frontend/public/${path}`).toString());
      for (const key of ['id', 'start_url', 'scope']) expect(manifest[key]).toBe(baseline[key]);
      expect(manifest.icons).toEqual(baseline.icons);
      for (const icon of manifest.icons as Array<{ src: string; sizes: string; purpose: string }>) {
        expect(icon.src).toMatch(/^\/icons\/thatcampus-icon-(192|512)-v4\.png$/); expect(icon.purpose).toBe('any');
        const decoded = alphaRange(file(`frontend/public${icon.src}`));
        expect(icon.sizes).toBe(`${decoded.width}x${decoded.height}`);
        expect(decoded.width).toBe(decoded.height);
        expect(decoded.opaque).toBe(decoded.width * decoded.height);
      }
    }
  });
});
