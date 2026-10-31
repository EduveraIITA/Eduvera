import { createElement, useEffect, useRef, useState } from 'react';
import type { NativePendingFile } from '../lib/native-pending-action';
import { GATE_PHOTO_MAX_BYTES, gatePhotoMetadata } from '../lib/gate-visitor';
import { addCapturedPrivateFile, removePrivateFile } from '../lib/private-file.web';
import { ScreenBack, useScreenExitGuard } from '../ui/BackNavigation';
import { ControlButton } from '../ui/DomainControls';
import { Notice, Section } from '../ui/components';
import type { GateLanguage } from '../lib/gate-operator-policy';
import { gateVisitorEntryCopy } from './gate/visitor-entry-copy';
import { useGateCameraLease } from './gate/useGateCameraLease';
const stop = (media: MediaStream | null) => media?.getTracks().forEach(track => { try { track.stop(); } catch { /* Release all remaining tracks too. */ } });

export function VisitorCamera({ source, onPhoto, onClose, language = 'en' }: { source: string; onPhoto(photo: NativePendingFile): void; onClose(): void; language?: GateLanguage }) {
  const t = gateVisitorEntryCopy(language), video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null), generation = useRef(0), mounted = useRef(false);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const { active, capture } = useGateCameraLease(source);
  useScreenExitGuard({ blocked: busy });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const attempt = ++generation.current; setReady(false);
    if (active) {
      try {
        const assertCurrent = capture();
        void navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } }).then(async media => {
          try {
            if (attempt !== generation.current) { stop(media); return; } assertCurrent();
            const element = video.current; if (!element) { stop(media); return; }
            stream.current = media; element.srcObject = media; await element.play();
            if (attempt !== generation.current) { stop(media); return; } assertCurrent(); setReady(true);
          } catch { stop(media); if (stream.current === media) stream.current = null; if (attempt === generation.current && mounted.current) setError(t.cameraUnavailable); }
        }).catch(() => { if (attempt === generation.current && mounted.current) setError(t.cameraUnavailable); });
      } catch { setError(t.cameraUnavailable); }
    }
    return () => { generation.current++; const media = stream.current; stream.current = null; stop(media); };
  }, [active, capture, t.cameraUnavailable]);
  const take = async () => {
    if (!active || !ready || busy || !video.current?.videoWidth) return;
    const attempt = generation.current; setBusy(true); let uri = '';
    try {
      const assertCurrent = capture(), element = video.current, scale = Math.min(1,1200/Math.max(element.videoWidth,element.videoHeight)), canvas = document.createElement('canvas');
      canvas.width = Math.max(1,Math.round(element.videoWidth*scale)); canvas.height = Math.max(1,Math.round(element.videoHeight*scale));
      const context = canvas.getContext('2d'); if (!context) throw new Error(t.photoFailed); context.drawImage(element,0,0,canvas.width,canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve,'image/jpeg',.82)); assertCurrent();
      if (attempt !== generation.current || !blob) throw new Error(t.photoFailed);
      const bytes = new Uint8Array(await blob.arrayBuffer()); assertCurrent(); gatePhotoMetadata(blob.type,blob.size,bytes);
      const file = await addCapturedPrivateFile(blob,'visitor.jpg',GATE_PHOTO_MAX_BYTES); uri = file.uri; assertCurrent();
      if (attempt !== generation.current) throw new Error(t.photoFailed);
      const hash = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer)), value => value.toString(16).padStart(2,'0')).join('');
      assertCurrent(); onPhoto({ ...file,hash }); uri = ''; onClose();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : t.photoFailed); }
    finally { if (uri) await removePrivateFile(uri).catch(() => {}); if (mounted.current) setBusy(false); }
  };
  return <Section title={t.photo}><ScreenBack title={t.backEntry} priority={30} onPress={onClose} preservesDraft/>{active ? <>{createElement('video',{ ref: video,playsInline: true,muted: true,style: { width:'100%',maxHeight:320,borderRadius:20,objectFit:'contain' } })}<ControlButton title={t.capture} kind="primary" disabled={!ready || busy} busy={busy} onPress={() => void take()}/></> : <Notice message={t.cameraPaused}/>}{error ? <Notice tone="warning" message={error}/> : null}<ControlButton title={t.close} disabled={busy} onPress={onClose}/></Section>;
}
