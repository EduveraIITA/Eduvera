import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
export default function QRScanner({onScan,hindi}:{onScan:(qr:string)=>void;hindi:boolean}) {
 const video=useRef<HTMLVideoElement>(null);
 const callback=useRef(onScan);
 useEffect(()=>{callback.current=onScan;},[onScan]);
 const [error,setError]=useState(false);const [active,setActive]=useState(false);
 useEffect(()=>{
  let stream:MediaStream|undefined,frame=0,disposed=false,scanned=false;
  const canvas=document.createElement('canvas');const context=canvas.getContext('2d',{willReadFrequently:true});
  async function start(){try{
   stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
   if(disposed){stream.getTracks().forEach(t=>t.stop());return;}
   if(!video.current)return;video.current.srcObject=stream;await video.current.play();if(!disposed)setActive(true);
   let lastFrame=0;
   const tick=()=>{if(disposed||scanned)return;const v=video.current;
    if(v&&context&&v.readyState>=2&&performance.now()-lastFrame>200){lastFrame=performance.now();canvas.width=640;canvas.height=Math.round(v.videoHeight*640/v.videoWidth);context.drawImage(v,0,0,canvas.width,canvas.height);const pixels=context.getImageData(0,0,canvas.width,canvas.height);const qr=jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'dontInvert'});
     if(qr){scanned=true;stream?.getTracks().forEach(t=>t.stop());callback.current(qr.data);return;}}
    frame=requestAnimationFrame(tick);
   };tick();
  }catch{if(!disposed)setError(true);}}
  void start();return ()=>{disposed=true;cancelAnimationFrame(frame);stream?.getTracks().forEach(t=>t.stop());};
 },[]);
 return <div className="gate-camera">{error?<p role="alert">{hindi?'कैमरा नहीं खुला। कैमरे की अनुमति दें या छात्र खोजें।':'Camera unavailable. Allow camera access or find the student.'}</p>:<><div className="gate-viewfinder"><span className="gate-camera-badge">{active?(hindi?'कैमरा चालू है':'Camera active'):(hindi?'कैमरा शुरू हो रहा है…':'Starting camera…')}</span><video ref={video} muted playsInline aria-label={hindi?'QR कैमरा':'QR camera'}/><div className="gate-scan-frame" aria-hidden="true"><span/></div></div><p className="gate-camera-state" role="status">{active?(hindi?'कैमरा चालू है':'Camera active'):(hindi?'कैमरा शुरू हो रहा है…':'Starting camera…')}</p><p>{hindi?'QR को कैमरे के सामने रखें':'Hold the QR in front of the camera'}</p></>}</div>;
}
