import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import { shareLocalDocument } from './share-local-document-core';
export function shareCampusDraft(text:string,name:string,assertCurrent:()=>void){return shareLocalDocument(text,name,{isAvailable:Sharing.isAvailableAsync,createTemporaryFile(filename){const file=new File(Paths.cache,`thatcampus-${Crypto.randomUUID()}-${filename}`);try{file.create({overwrite:false});}catch(error){if(file.exists)file.delete();throw error;}return{uri:file.uri,write:async bytes=>file.write(bytes),delete:()=>{if(file.exists)file.delete();}};},share:(uri,options)=>Sharing.shareAsync(uri,options)},assertCurrent);}
