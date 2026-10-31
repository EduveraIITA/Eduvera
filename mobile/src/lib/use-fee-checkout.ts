import { useEffect, useSyncExternalStore } from 'react';
import * as Crypto from 'expo-crypto';
import * as DeviceStorage from './device-storage';
import { useSession } from '../auth/SessionProvider';
import { apiFetch } from './api';
import { FeeCheckoutController } from './fee-checkout-controller';
const entries=new Map<string,FeeCheckoutController>();
export function useFeeCheckout(schoolId:string){
 const {scopeKey,environment}=useSession();let controller=entries.get(scopeKey);if(!controller){let key:Promise<string>|undefined;const storageKey=()=>key??=Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,`checkout:${scopeKey}`).then(hash=>`thatcampus.fee-action.${hash}`);controller=new FeeCheckoutController({scopeKey,schoolId,mode:environment.mode,storage:{read:async()=>DeviceStorage.getItemAsync(await storageKey()),write:async value=>DeviceStorage.setItemAsync(await storageKey(),value,{keychainAccessible:DeviceStorage.WHEN_UNLOCKED_THIS_DEVICE_ONLY}),clear:async()=>DeviceStorage.deleteItemAsync(await storageKey())},request:apiFetch});entries.set(scopeKey,controller);}
 const state=useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);useEffect(()=>{void controller.hydrate();},[controller]);return{...state,controller};
}
