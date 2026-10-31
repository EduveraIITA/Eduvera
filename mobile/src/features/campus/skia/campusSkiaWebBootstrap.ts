import type { CanvasKit } from 'canvaskit-wasm';
import { CAMPUS_SKIA_WEB_ASSET } from './campusSkiaWebAsset.generated';

export interface CampusSkiaWebBootstrapPorts<T> {
  loaded(): T | undefined;
  initialize(): Promise<T>;
  publish(value: T): void;
}

/** Unlike upstream LoadSkiaWeb's retained rejection, a failed attempt can retry. */
export function createCampusSkiaWebBootstrap<T>(ports: CampusSkiaWebBootstrapPorts<T>): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    if (ports.loaded() !== undefined) return Promise.resolve();
    if (!pending) pending = ports.initialize().then(value => { ports.publish(value); }).catch(error => { pending = null; throw error; });
    return pending;
  };
}

/** Expo substitutes EXPO_BASE_URL for deployments mounted below an origin path. */
export function campusSkiaWebAssetUrl(baseUrl = process.env.EXPO_BASE_URL ?? ''): string {
  return `${baseUrl.replace(/\/$/, '')}${CAMPUS_SKIA_WEB_ASSET.path}`;
}

const canvasGlobal = globalThis as typeof globalThis & { CanvasKit?: CanvasKit };
export const prepareCampusSkiaWeb = createCampusSkiaWebBootstrap<CanvasKit>({
  loaded: () => canvasGlobal.CanvasKit,
  initialize: async () => {
    const { default: initialize } = await import('canvaskit-wasm/full');
    return initialize({ locateFile: filename => filename.endsWith('.wasm') ? campusSkiaWebAssetUrl() : filename });
  },
  // This is the same documented global consumed by WithSkiaWeb/Skia.web.
  publish: value => { canvasGlobal.CanvasKit = value; },
});
