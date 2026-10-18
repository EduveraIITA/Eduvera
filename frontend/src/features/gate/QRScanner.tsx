import { useEffect, useRef, useState } from 'react';
import { Flashlight, FlashlightOff, Images } from 'lucide-react';
import jsQR from 'jsqr';

export default function QRScanner({ onScan, hindi }: { onScan: (qr: string) => void; hindi: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const callback = useRef(onScan);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [torch, setTorch] = useState(false);
  const [scanError, setScanError] = useState('');
  useEffect(() => { callback.current = onScan; }, [onScan]);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let frame = 0;
    let disposed = false;
    let scanned = false;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        streamRef.current = stream;
        if (disposed) { stream.getTracks().forEach(track => track.stop()); return; }
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        if (!disposed) {
          setActive(true);
          const capabilities = stream.getVideoTracks()[0]?.getCapabilities();
          setHasTorch(Boolean(capabilities && 'torch' in capabilities && capabilities.torch));
        }
        let lastFrame = 0;
        const tick = () => {
          if (disposed || scanned) return;
          const current = video.current;
          if (current && context && current.readyState >= 2 && performance.now() - lastFrame > 200) {
            lastFrame = performance.now();
            canvas.width = 640;
            canvas.height = Math.round(current.videoHeight * 640 / current.videoWidth);
            context.drawImage(current, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            const result = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'dontInvert' });
            if (result) { scanned = true; stream?.getTracks().forEach(track => track.stop()); callback.current(result.data); return; }
          }
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch { if (!disposed) setError(true); }
    }
    void start();
    return () => { disposed = true; cancelAnimationFrame(frame); stream?.getTracks().forEach(track => track.stop()); streamRef.current = undefined; };
  }, []);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(value => !value);
      setScanError('');
    } catch { setScanError(hindi ? 'इस कैमरे में फ़्लैशलाइट उपलब्ध नहीं है।' : 'Flashlight is unavailable on this camera.'); }
  }

  async function scanImage(selected: File) {
    setScanError('');
    try {
      const bitmap = await createImageBitmap(selected);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Image decode failed');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(pixels.data, pixels.width, pixels.height);
      if (!result) throw new Error('QR not found');
      callback.current(result.data);
    } catch { setScanError(hindi ? 'इस तस्वीर में QR कोड नहीं मिला। दूसरी तस्वीर चुनें।' : 'No QR code found in that image. Choose another photo.'); }
  }

  return <div className="gate-camera">
    {error ? <p role="alert">{hindi ? 'कैमरा नहीं खुला। कैमरे की अनुमति दें या छात्र खोजें।' : 'Camera unavailable. Allow camera access or find the student.'}</p> : <>
      <div className="gate-viewfinder"><span className="gate-camera-badge">{active ? (hindi ? 'कैमरा चालू है' : 'Camera active') : (hindi ? 'कैमरा शुरू हो रहा है…' : 'Starting camera…')}</span><video ref={video} muted playsInline aria-label={hindi ? 'QR कैमरा' : 'QR camera'}/><div className="gate-scan-frame" aria-hidden="true"><span/></div></div>
      <p className="gate-camera-state" role="status">{active ? (hindi ? 'कैमरा चालू है' : 'Camera active') : (hindi ? 'कैमरा शुरू हो रहा है…' : 'Starting camera…')}</p>
      <p>{hindi ? 'QR को कैमरे के सामने रखें' : 'Hold the QR in front of the camera'}</p>
    </>}
    {scanError ? <p className="gate-error" role="alert">{scanError}</p> : null}
    <div className="gate-scan-controls">
      {hasTorch ? <button type="button" onClick={() => void toggleTorch()} aria-pressed={torch}>{torch ? <FlashlightOff size={17}/> : <Flashlight size={17}/>}<span>{torch ? (hindi ? 'फ़्लैशलाइट बंद करें' : 'Turn flashlight off') : (hindi ? 'फ़्लैशलाइट' : 'Flashlight')}</span></button> : null}
      <input ref={file} className="gate-file-input" type="file" accept="image/*" aria-label={hindi ? 'गैलरी से QR तस्वीर चुनें' : 'Choose a QR photo from gallery'} onChange={event => { const selected = event.currentTarget.files?.[0]; if (selected) void scanImage(selected); event.currentTarget.value = ''; }}/>
      <button type="button" onClick={() => file.current?.click()}><Images size={17}/><span>{hindi ? 'गैलरी' : 'Gallery'}</span></button>
    </div>
  </div>;
}
