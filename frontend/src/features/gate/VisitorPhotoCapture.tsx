import { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';

export function VisitorPhotoCapture({hindi,busy,onChange,onProcessing}:{hindi:boolean;busy:boolean;onChange:(file:File|null)=>void;onProcessing:(value:boolean)=>void}) {
 const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null),generation=useRef(0);
 const [preview,setPreview]=useState(''),[error,setError]=useState('');
 const [open,setOpen]=useState(false),[ready,setReady]=useState(false),[saving,setSaving]=useState(false);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
 useEffect(()=>()=>{generation.current++;stream.current?.getTracks().forEach(track=>track.stop());},[]);
 function close(){
  generation.current++;stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;
  if(video.current)video.current.srcObject=null;
  setOpen(false);setReady(false);setSaving(false);onProcessing(false);
 }
 async function start(){
  const attempt=++generation.current;
  setError('');setOpen(true);setReady(false);onProcessing(true);
  try{
   const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
   if(attempt!==generation.current){media.getTracks().forEach(track=>track.stop());return;}
   stream.current=media;
   if(!video.current)throw new Error('Camera unavailable');
   video.current.srcObject=media;await video.current.play();
  }catch{
   if(attempt!==generation.current)return;
   close();setError(hindi?'कैमरा नहीं खुल सका। कैमरे की अनुमति दें और फिर कोशिश करें।':'Could not open the camera. Allow camera access and try again.');
  }
 }
 async function capture(){
  if(!video.current?.videoWidth||!video.current.videoHeight||saving)return;
  const attempt=generation.current;setSaving(true);setError('');
  try{
   const source=video.current,scale=Math.min(1,1200/Math.max(source.videoWidth,source.videoHeight));
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(source.videoWidth*scale));canvas.height=Math.max(1,Math.round(source.videoHeight*scale));
   const context=canvas.getContext('2d');if(!context)throw new Error('Photo unavailable');
   context.drawImage(source,0,0,canvas.width,canvas.height);
   // Encode camera pixels directly, including on iPhones configured for HEIF.
   const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',0.82));
   if(attempt!==generation.current)return;
   if(!blob||blob.type!=='image/jpeg'||blob.size>2*1024*1024)throw new Error('Photo unavailable');
   const file=new File([blob],'visitor.jpg',{type:'image/jpeg'});
   setPreview(URL.createObjectURL(file));onChange(file);close();
  }catch{
   if(attempt!==generation.current)return;
   setSaving(false);setError(hindi?'फोटो नहीं ली जा सकी। फिर कोशिश करें।':'Could not capture the photo. Try again.');
  }
 }
 return <section className="gate-photo-field" aria-label={hindi?'आगंतुक की फोटो':'Visitor photo'}>
  <div className="gate-photo-preview">{preview?<img src={preview} alt={hindi?'आगंतुक की फोटो का पूर्वावलोकन':'Visitor photo preview'}/>:<Camera size={30} aria-hidden="true"/>}</div>
  <div><h3>{hindi?'आगंतुक की फोटो':'Visitor photo'}</h3><p>{hindi?'मिलने वाला व्यक्ति अनुमति देने से पहले यह फोटो देख सकेगा।':'The host can review this photo before approving.'}</p>
   <div className="gate-photo-actions"><button type="button" disabled={busy||open} onClick={()=>{void start();}}><Camera size={16}/>{preview?(hindi?'फिर से फोटो लें':'Retake photo'):(hindi?'फोटो लें':'Take photo')}</button>{preview?<button type="button" disabled={busy||open} aria-label={hindi?'फोटो हटाएँ':'Remove photo'} onClick={()=>{setPreview('');onChange(null);}}><X size={16}/></button>:null}</div>
   <small>{hindi?'वैकल्पिक · कैमरे से फोटो लें':'Optional · Capture with your camera'}</small>
  </div>
  {open?<div className="gate-photo-camera" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();close();}}}>
   <video ref={video} autoPlay playsInline muted aria-label={hindi?'कैमरे का दृश्य':'Visitor camera preview'} onCanPlay={()=>setReady(true)}/>
   {!ready?<p role="status">{hindi?'कैमरा खुल रहा है…':'Opening camera…'}</p>:null}
   <div className="gate-photo-actions"><button type="button" disabled={!ready||saving} onClick={()=>{void capture();}}><Camera size={16}/>{saving?(hindi?'फोटो तैयार हो रही है…':'Preparing photo…'):(hindi?'फोटो खींचें':'Capture photo')}</button><button type="button" onClick={close}>{hindi?'रद्द करें':'Cancel camera'}</button></div>
  </div>:null}
  {error?<p className="gate-error" role="alert">{error}</p>:null}
 </section>;
}
