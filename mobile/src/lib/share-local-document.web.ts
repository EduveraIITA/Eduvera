import { createBrowserDownloadAdapter } from './browser-private-download';
import { shareLocalDocument } from './share-local-document-core';
export function shareCampusDraft(text:string,name:string,assertCurrent:()=>void){return shareLocalDocument(text,name,createBrowserDownloadAdapter(),assertCurrent);}
