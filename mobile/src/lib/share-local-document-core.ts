import type { CampusDownloadAdapter } from './api-client';
import { safeDownloadFilename } from './api-policy';
/** Share a captured local draft through the same temporary-file lifecycle as
 * private downloads. Cancellation or context drift always releases its copy. */
export async function shareLocalDocument(text:string,filename:string,adapter:CampusDownloadAdapter,assertCurrent:()=>void){
 assertCurrent();const bytes=new TextEncoder().encode(text);if(!bytes.length||bytes.length>8*1024*1024)throw new Error('This draft exceeds the local export limit.');
 if(!await adapter.isAvailable())throw new Error('File sharing is unavailable on this device.');assertCurrent();let file:Awaited<ReturnType<CampusDownloadAdapter['createTemporaryFile']>>|undefined;
 try{file=await adapter.createTemporaryFile(safeDownloadFilename(filename));assertCurrent();await file.write(bytes);assertCurrent();await adapter.share(file.uri,{mimeType:'application/json',dialogTitle:'Share campus draft'});}finally{await file?.delete();}
}
