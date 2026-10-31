import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import * as visitorPolicy from '../src/lib/gate-visitor';
import * as copy from '../src/features/gate/visitor-entry-copy';
const require = createRequire(import.meta.url), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createRoot } = require('react-dom/client'), { JSDOM } = require('jsdom');
const jpeg = new Uint8Array([255,216,255,0,0,0]), cacheUri = 'file:///app/cache/captured-owned.jpg', pickedUri = 'file:///app/cache/picked-owned.jpg';
function deferred<T>() { let resolve!: (value: T) => void, reject!: (cause: unknown) => void; const promise = new Promise<T>((yes,no) => { resolve=yes; reject=no; }); return { promise,resolve,reject }; }
function load(file: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const absolute=path.join(root,file),exports:Record<string,any>={};
  const source=ts.transpileModule(readFileSync(absolute,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  runInNewContext(source,{exports,Uint8Array,ArrayBuffer,URL,JSON,...globals,require(name:string){if(!(name in dependencies))throw new Error(`Unexpected photo dependency ${name}`);return dependencies[name];}},{filename:absolute,timeout:1000});return exports;
}
async function harness(kind:'entry'|'native'|'web',run:(h:any)=>Promise<void>,options:{entryCamera?:'native'|'web';pick?:()=>Promise<any>;take?:()=>Promise<{uri:string}>;read?:()=>Promise<any>;digest?:()=>Promise<ArrayBuffer>;media?:()=>Promise<any>;permission?:()=>Promise<{granted:boolean}>}={}) {
  const dom=new JSDOM('<div id="root"></div>'),previous={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  dom.window.HTMLMediaElement.prototype.play=async()=>{};
  Object.defineProperty(dom.window.HTMLVideoElement.prototype,'videoWidth',{get:()=>1200});Object.defineProperty(dom.window.HTMLVideoElement.prototype,'videoHeight',{get:()=>900});
  dom.window.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});dom.window.HTMLCanvasElement.prototype.toBlob=(callback:(blob:Blob)=>void)=>callback(new Blob([jpeg],{type:'image/jpeg'}));
  let focused=true,epoch=1,rendered=true;const session:any={scopeKey:'actor-a:campus-a:world-a',status:'authenticated',schoolId:'campus-a',user:{id:'actor-a'},environment:{mode:'simulation',namespace_id:'world-a'}};
  const removals:string[]=[],adopted:any[]=[],fieldSetters=new Map<string,(value:string)=>void>(),listeners=new Set<(value:string)=>void>(),guards=new Map<symbol,any>();let closed=0,cameraMounts=0,cameraUnmounts=0;
  const AppState={currentState:'active',addEventListener(_name:string,listener:(value:string)=>void){listeners.add(listener);return{remove:()=>listeners.delete(listener)};}};
  const useSession=()=>session,api={getApiOrigin:()=> 'https://campus.example',captureApiContext:()=>{const old=epoch;return{assertCurrent(){if(old!==epoch)throw new Error('Changed source transport');}};}};
  const react={react:React,'react/jsx-runtime':require('react/jsx-runtime')},native={AppState,View:({children}:any)=>React.createElement('div',null,children),Linking:{openSettings:async()=>{}}};
  const operation=load('src/lib/use-operation-context.ts',{...react,'react-native':native,'expo-router':{useIsFocused:()=>focused},'../auth/SessionProvider':{useSession},'./api':api});
  const lease=load('src/features/gate/useGateCameraLease.ts',{...react,'react-native':native,'expo-router':{useIsFocused:()=>focused},'../../auth/SessionProvider':{useSession},'../../lib/use-operation-context':operation});
  const Button=({title,onPress,disabled,busy}:any)=>React.createElement('button',{disabled:disabled||busy,onClick:onPress},title);
  const components={Notice:({message}:any)=>React.createElement('p',null,message),Section:({title,children}:any)=>React.createElement('section',null,React.createElement('h2',null,title),children),Field:({label,value,onChangeText}:any)=>{fieldSetters.set(label,onChangeText);return React.createElement('input',{'aria-label':label,value,readOnly:true});},Empty:({title}:any)=>React.createElement('p',null,title),Loading:()=>null,Row:({title,detail}:any)=>React.createElement('p',null,title,detail)};
  const privateFiles={pickPrivateFile:options.pick??(async()=>({uri:pickedUri,name:'photo.jpg',type:'image/jpeg'})),readPrivateFile:async(uri:string)=>options.read?options.read():{uri,size:jpeg.length,bytes:jpeg},removePrivateFile:async(uri:string)=>{removals.push(uri);}};
  const digest=options.digest??(async()=>new Uint8Array(32).buffer);
  const Camera=React.forwardRef((_props:any,ref:any)=>{React.useImperativeHandle(ref,()=>({takePictureAsync:options.take??(async()=>({uri:cacheUri})),getAvailablePictureSizesAsync:async()=>['1200x900']}));React.useEffect(()=>{cameraMounts++;void Promise.resolve().then(()=>_props.onCameraReady());return()=>{cameraUnmounts++;};},[]);return React.createElement('div',{'data-native-camera':'active'});});
  const useCameraPermissions=()=>{const[value,setValue]=React.useState({granted:!options.permission});return[value,async()=>{const next=options.permission?await options.permission():{granted:true};setValue(next);return next;}];};
  const shared:any={...react,'react-native':native,'expo-camera':{CameraView:Camera,useCameraPermissions},'expo-crypto':{CryptoDigestAlgorithm:{SHA256:'SHA256'},digest},'../lib/gate-visitor':visitorPolicy,'../lib/private-file':privateFiles,'../lib/use-operation-context':operation,'../ui/BackNavigation':{ScreenBack:({title,onPress,preservesDraft}:any)=>React.createElement('button',{onClick:onPress,'data-header-back':true,'data-preserves-draft':!!preservesDraft},title),useScreenExitGuard(value:any){const id=React.useRef(Symbol());guards.set(id.current,value);React.useEffect(()=>()=>{guards.delete(id.current);},[]);}},'../ui/DomainControls':{ControlButton:Button,ChoiceMenu:()=>null},'../ui/components':components,'./gate/visitor-entry-copy':copy,'./gate/useGateCameraLease':lease};
  const mediaGlobals={navigator:{mediaDevices:{getUserMedia:options.media??(async()=>({getTracks:()=>[]}))}},document:dom.window.document,crypto:{subtle:{digest}},Blob};
  let component:any;
  if(kind==='entry'){
    const visitorCamera=options.entryCamera?load(`src/features/VisitorCamera${options.entryCamera==='web'?'.web':''}.tsx`,{...shared,'../lib/private-file.web':{addCapturedPrivateFile:async()=>({uri:'thatcampus-picked://owned-camera',name:'visitor.jpg',type:'image/jpeg',size:jpeg.length}),removePrivateFile:privateFiles.removePrivateFile}},mediaGlobals).VisitorCamera:()=>null;
    component=load('src/features/GateVisitorEntry.tsx',{...shared,'../auth/SessionProvider':{useSession},'../lib/api':api,'../lib/query':{useApi:()=>({data:{hosts:[]},isPending:false,isError:false,refetch:async()=>({data:{hosts:[]}})})},'../lib/native-pending-action':{useNativePendingAction:()=>({locked:false,busy:false,action:null,error:''})},'../ui/PrivateFilePreview':{PrivateFilePreview:({uri}:any)=>React.createElement('div',{'data-photo':uri})},'./VisitorCamera':{VisitorCamera:visitorCamera}}).GateVisitorEntry;
  }
  else component=load(`src/features/VisitorCamera${kind==='web'?'.web':''}.tsx`,{...shared,'../lib/private-file.web':{addCapturedPrivateFile:async()=>({uri:'thatcampus-picked://owned-camera',name:'visitor.jpg',type:'image/jpeg',size:jpeg.length}),removePrivateFile:privateFiles.removePrivateFile}},mediaGlobals).VisitorCamera;
  const renderer=createRoot(dom.window.document.getElementById('root')),props:Record<string,unknown>=kind==='entry'?{href:'/areas/in-out/operate',schoolId:'campus-a',onSaved(){},onClose:()=>{closed++;}}:{source:'/api/v1/gate/schools/campus-a/visitors/',onPhoto:(photo:any)=>{adopted.push(photo);},onClose:()=>{closed++;}};
  const render=async()=>{await act(async()=>renderer.render(React.createElement(component,props)));};
  const h={removals,adopted,guards,doc:dom.window.document,render,closed:()=>closed,cameraMounts:()=>cameraMounts,cameraUnmounts:()=>cameraUnmounts,
    click:async(title:string)=>{const button=[...dom.window.document.querySelectorAll('button')].find((value:any)=>value.textContent===title) as HTMLButtonElement|undefined;assert.ok(button,`Missing ${title}`);assert.equal(button.disabled,false,title);await act(async()=>button.click());},
    field:async(label:string,value:string)=>{await act(async()=>fieldSetters.get(label)!(value));},
    focus:async(value:boolean)=>{focused=value;await render();},scope:async()=>{epoch++;session.scopeKey='actor-b:campus-a:world-b';session.user={id:'actor-b'};await render();},
    foreground:async(value:string)=>{AppState.currentState=value;await act(async()=>listeners.forEach(listener=>listener(value)));await render();},
    unmount:async()=>{if(rendered){rendered=false;await act(async()=>renderer.unmount());}},
  };
  try{await render();await run(h);}finally{await h.unmount();Object.assign(globalThis,{...previous,IS_REACT_ACT_ENVIRONMENT:false});dom.window.close();}
}

test('native and browser camera views retain the visitor draft guard, and local Back returns to its same draft',async()=>{
  for(const entryCamera of ['native','web'] as const)await harness('entry',async h=>{
    await h.field('Visitor name','Unsent visitor entry');await h.field('Purpose · optional','Campus meeting');
    await h.click('Take optional photo');
    assert.equal(h.doc.querySelector('input[aria-label="Visitor name"]'),null);
    assert.ok([...h.guards.values()].some((guard:any)=>guard.dirty),'A losing route or tab reset still sees the parent visitor draft');
    assert.equal(h.doc.querySelector('[data-header-back]').getAttribute('data-preserves-draft'),'true','Only returning from camera is a draft-preserving Back');
    await h.click('Back to visitor entry');
    assert.equal(h.doc.querySelector('input[aria-label="Visitor name"]').value,'Unsent visitor entry');
    assert.equal(h.doc.querySelector('input[aria-label="Purpose · optional"]').value,'Campus meeting');
    assert.ok([...h.guards.values()].some((guard:any)=>guard.dirty));assert.equal(h.guards.size,1,'The camera guard unmounts; the parent guard stays owned');
    assert.equal(h.doc.querySelector('[data-header-back]').getAttribute('data-preserves-draft'),'false','Closing visitor entry remains an ordinary losing exit');
    assert.equal(h.closed(),0);assert.deepEqual(h.removals,[]);
  },{entryCamera});
});

test('native late capture owns and deletes only its newly returned cache file after blur/reentry or unmount',async()=>{
  for(const ending of ['blur-return','background-return','unmount']){const pending=deferred<{uri:string}>();await harness('native',async h=>{
    await h.click('Capture photo');
    if(ending==='unmount')await h.unmount();else if(ending==='blur-return'){await h.focus(false);assert.equal(h.doc.querySelectorAll('[data-native-camera]').length,0);await h.focus(true);}else{await h.foreground('background');assert.equal(h.doc.querySelectorAll('[data-native-camera]').length,0);await h.foreground('active');}
    await act(async()=>pending.resolve({uri:cacheUri}));assert.deepEqual(h.adopted,[]);assert.deepEqual(h.removals,[cacheUri]);assert.ok(!h.removals.includes('file:///user/original.jpg'));
  },{take:()=>pending.promise});}
});

test('native preview unmounts while hidden and valid capture transfers the owned file without premature deletion',async()=>harness('native',async h=>{
  assert.equal(h.cameraMounts(),1);await h.foreground('background');assert.equal(h.cameraUnmounts(),1);assert.equal(h.doc.querySelectorAll('[data-native-camera]').length,0);await h.foreground('active');assert.equal(h.cameraMounts(),2);
  await h.click('Capture photo');assert.equal(h.adopted[0].uri,cacheUri);assert.deepEqual(h.removals,[]);assert.equal(h.closed(),1);
}));

test('late native permission cannot open a preview while its retained screen is hidden',async()=>{
  const permission=deferred<{granted:boolean}>();await harness('native',async h=>{await h.click('Allow camera');await h.focus(false);await act(async()=>permission.resolve({granted:true}));assert.equal(h.cameraMounts(),0);assert.equal(h.doc.querySelectorAll('[data-native-camera]').length,0);await h.focus(true);assert.equal(h.cameraMounts(),1);},{permission:()=>permission.promise});
});

test('capture read, validation and hashing failures clean the unadopted native cache file',async()=>{
  for(const failure of ['read','validation','hash'])await harness('native',async h=>{await h.click('Capture photo');assert.deepEqual(h.removals,[cacheUri]);assert.deepEqual(h.adopted,[]);},{read:failure==='read'?async()=>{throw new Error('Read failed');}:failure==='validation'?async()=>({size:6,bytes:new Uint8Array(6)}):undefined,digest:failure==='hash'?async()=>{throw new Error('Hash failed');}:undefined});
});

test('late picker result is cleaned before a lost source can adopt it, while visitor text stays mounted',async()=>{
  for(const ending of ['scope','blur','unmount']){const pending=deferred<any>();await harness('entry',async h=>{
    await h.field('Visitor name','Existing unsent visitor');await h.click('Choose optional JPEG or PNG');if(ending==='scope')await h.scope();else if(ending==='blur')await h.focus(false);else await h.unmount();
    await act(async()=>pending.resolve({uri:pickedUri,type:'image/jpeg',name:'photo.jpg'}));assert.deepEqual(h.removals,[pickedUri]);assert.equal(h.doc.querySelectorAll('[data-photo]').length,0);
    if(ending==='blur')assert.equal(h.doc.querySelector('input[aria-label="Visitor name"]').value,'Existing unsent visitor');
  },{pick:()=>pending.promise});}
});

test('picker cancellation touches no file; validation/read/hash failures release only the new owned copy',async()=>{
  await harness('entry',async h=>{await h.click('Choose optional JPEG or PNG');assert.deepEqual(h.removals,[]);},{pick:async()=>null});
  for(const failure of ['read','validation','hash'])await harness('entry',async h=>{await h.click('Choose optional JPEG or PNG');assert.deepEqual(h.removals,[pickedUri]);assert.equal(h.doc.querySelectorAll('[data-photo]').length,0);},{read:failure==='read'?async()=>{throw new Error('Read failed');}:failure==='validation'?async()=>({size:6,bytes:new Uint8Array(6)}):undefined,digest:failure==='hash'?async()=>{throw new Error('Hash failed');}:undefined});
});

test('successful picker adoption remains with the draft until replacement/removal/unmount',async()=>harness('entry',async h=>{
  await h.click('Choose optional JPEG or PNG');assert.equal(h.doc.querySelector('[data-photo]').getAttribute('data-photo'),pickedUri);assert.deepEqual(h.removals,[]);await h.click('Remove photo');assert.deepEqual(h.removals,[pickedUri]);
}));

test('browser late permission stops every returned stream track after blur/background and never attaches a hidden video',async()=>{
  for(const ending of ['blur','background','unmount']){const pending=deferred<any>();let stopped=0;await harness('web',async h=>{
    if(ending==='blur')await h.focus(false);else if(ending==='background')await h.foreground('background');else await h.unmount();
    await act(async()=>pending.resolve({getTracks:()=>[{stop(){stopped++;}},{stop(){stopped++;}}]}));assert.equal(stopped,2);assert.equal(h.doc.querySelectorAll('video').length,0);
  },{media:()=>pending.promise});}
});

test('an active browser stream stops on retained-tab blur and background; returning opens a new lease',async()=>{
  let stopped=0,opened=0;await harness('web',async h=>{assert.equal(opened,1);await h.focus(false);assert.equal(stopped,1);await h.focus(true);assert.equal(opened,2);await h.foreground('background');assert.equal(stopped,2);assert.equal(h.doc.querySelectorAll('video').length,0);},{media:async()=>{opened++;return{getTracks:()=>[{stop(){stopped++;}}]};}});
});

test('browser capture hash interruption releases its newly created opaque handle without adopting it',async()=>{
  const hashing=deferred<ArrayBuffer>();await harness('web',async h=>{await h.click('Capture photo');await h.foreground('background');await h.foreground('active');await act(async()=>hashing.resolve(new Uint8Array(32).buffer));assert.deepEqual(h.adopted,[]);assert.deepEqual(h.removals,['thatcampus-picked://owned-camera']);},{digest:()=>hashing.promise});
});

test('native picker requests an app-cache copy; cleanup never targets the original document-provider URI',async()=>{
  let options:any;const removed:string[]=[];
  class File{exists=true;constructor(public uri:string){}delete(){removed.push(this.uri);}}
  const adapter=load('src/lib/private-file.ts',{'expo-document-picker':{getDocumentAsync:async(value:any)=>{options=value;return{canceled:false,assets:[{uri:pickedUri,name:'photo.jpg',mimeType:'image/jpeg'}]};}},'expo-file-system':{File,Directory:class{},Paths:{}},'expo-crypto':{} });
  const picked=await adapter.pickPrivateFile(['image/jpeg','image/png']);assert.equal(options.copyToCacheDirectory,true);await adapter.removePrivateFile(picked.uri);assert.deepEqual(removed,[pickedUri]);assert.ok(!removed.includes('content://documents/original-photo'));
});
