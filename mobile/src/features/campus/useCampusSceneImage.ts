import { useEffect, useState } from 'react';
import { useSession } from '../../auth/SessionProvider';
import { readCampusImage } from '../../lib/api';
/** Private image bytes remain in this mounted view and are released on scope change. */
export function useCampusSceneImage(schoolId:string,campusId:string,imageId?:string) {
 const {scopeKey}=useSession(),[state,setState]=useState<{key:string;url?:string;error?:string}>({key:''});
 const key=JSON.stringify([scopeKey,schoolId,campusId,imageId]);
 useEffect(()=>{let active=true;const controller=new AbortController();setState({key});if(imageId)void readCampusImage(`/api/v1/schools/${encodeURIComponent(schoolId)}/campus-scenes/${encodeURIComponent(campusId)}/images/${encodeURIComponent(imageId)}/`,controller.signal).then(value=>{value.assertCurrent();if(!active)return;let binary='';for(let i=0;i<value.bytes.length;i+=0x8000)binary+=String.fromCharCode(...value.bytes.subarray(i,i+0x8000));setState({key,url:`data:${value.mimeType};base64,${btoa(binary)}`});}).catch(error=>{if(active&&!controller.signal.aborted)setState({key,error:error instanceof Error?error.message:'The private source image could not load.'});});return()=>{active=false;controller.abort();};},[key]);
 return state.key===key?state:{key};
}
