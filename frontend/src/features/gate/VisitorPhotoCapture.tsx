import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, X } from 'lucide-react';

export function VisitorPhotoCapture({hindi,busy,onChange,onProcessing}:{hindi:boolean;busy:boolean;onChange:(file:File|null)=>void;onProcessing:(value:boolean)=>void}) {
 const camera=useRef<HTMLInputElement>(null),attachment=useRef<HTMLInputElement>(null);
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState(''),[error,setError]=useState('');
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
 async function select(next?:File){
  setError('');
  if(!next)return;
  if(!['image/jpeg','image/png'].includes(next.type)||next.size>20*1024*1024){setError(hindi?'2 MB तक की JPEG या PNG फोटो चुनें।':'Choose a JPEG or PNG photo up to 2 MB.');return;}
  onProcessing(true);
  try {
   let ready=next;
   if(next.size>2*1024*1024){
    const url=URL.createObjectURL(next);
    try {
     const image=new Image();image.src=url;await image.decode();
     const scale=Math.min(1,1200/Math.max(image.naturalWidth,image.naturalHeight));
     const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
     const context=canvas.getContext('2d');if(!context)throw new Error('Photo unavailable');
     context.drawImage(image,0,0,canvas.width,canvas.height);
     const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',0.82));
     if(!blob||blob.size>2*1024*1024)throw new Error('Photo too large');
     ready=new File([blob],'visitor.jpg',{type:'image/jpeg'});
    }finally{URL.revokeObjectURL(url);}
   }
   setFile(ready);setPreview(URL.createObjectURL(ready));onChange(ready);
  }catch{setError(hindi?'फोटो पढ़ी नहीं जा सकी। दूसरी JPEG या PNG फोटो चुनें।':'Could not read this photo. Choose another JPEG or PNG image.');}
  finally{onProcessing(false);}
 }
 return <section className="gate-photo-field" aria-label={hindi?'आगंतुक की फोटो':'Visitor photo'}>
  <div className="gate-photo-preview">{preview?<img src={preview} alt={hindi?'आगंतुक की फोटो का पूर्वावलोकन':'Visitor photo preview'}/>:<Camera size={30} aria-hidden="true"/>}</div>
  <div><h3>{hindi?'आगंतुक की फोटो':'Visitor photo'}</h3><p>{hindi?'मिलने वाला व्यक्ति अनुमति देने से पहले यह फोटो देख सकेगा।':'The host can review this photo before approving.'}</p>
   <div className="gate-photo-actions"><button type="button" disabled={busy} onClick={()=>camera.current?.click()}><Camera size={16}/>{hindi?'फोटो लें':'Take photo'}</button><button type="button" disabled={busy} onClick={()=>attachment.current?.click()}><ImagePlus size={16}/>{hindi?'फोटो जोड़ें':'Attach photo'}</button>{file?<button type="button" disabled={busy} aria-label={hindi?'फोटो हटाएँ':'Remove photo'} onClick={()=>{setFile(null);setPreview('');onChange(null);}}><X size={16}/></button>:null}</div>
   <small>{hindi?'वैकल्पिक · JPEG / PNG · अधिकतम 2 MB':'Optional · JPEG / PNG · up to 2 MB'}</small>
  </div>
  <input className="gate-file-input" ref={camera} type="file" accept="image/jpeg,image/png" capture="environment" onChange={e=>{void select(e.target.files?.[0]);e.target.value='';}} disabled={busy} tabIndex={-1}/>
  <input className="gate-file-input" ref={attachment} type="file" accept="image/jpeg,image/png" onChange={e=>{void select(e.target.files?.[0]);e.target.value='';}} disabled={busy} tabIndex={-1}/>
  {error?<p className="gate-error" role="alert">{error}</p>:null}
 </section>;
}
