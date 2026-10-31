import * as Storage from './device-storage.web';
import type { NativePendingStorage } from './native-pending-action';
/** The browser uses its existing origin-isolated encrypted IndexedDB adapter. */
export function createLargeActionStorage(key: string): NativePendingStorage {
  if (!/^thatcampus\.pending\.v1\.campus\.[a-f0-9]{64}$/.test(key)) throw new Error('Large action storage requires an exact scoped campus journal.');
  return {read:()=>Storage.getItemAsync(key),write:async value=>{if(typeof value!=='string'||new TextEncoder().encode(value).byteLength>12*1024*1024)throw new Error('This layout exceeds the encrypted action limit. Nothing was sent.');await Storage.setItemAsync(key,value);},clear:()=>Storage.deleteItemAsync(key)};
}
