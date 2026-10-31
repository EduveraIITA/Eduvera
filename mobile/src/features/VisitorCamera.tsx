import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import type { NativePendingFile } from '../lib/native-pending-action';
import { gatePhotoMetadata, GATE_PHOTO_MAX_BYTES } from '../lib/gate-visitor';
import { readPrivateFile, removePrivateFile } from '../lib/private-file';
import { ScreenBack, useScreenExitGuard } from '../ui/BackNavigation';
import { ControlButton } from '../ui/DomainControls';
import { Notice, Section } from '../ui/components';
import type { GateLanguage } from '../lib/gate-operator-policy';
import { gateVisitorEntryCopy } from './gate/visitor-entry-copy';
import { useGateCameraLease } from './gate/useGateCameraLease';

export function VisitorCamera({ source, onPhoto, onClose, language = 'en' }: { source: string; onPhoto(photo: NativePendingFile): void; onClose(): void; language?: GateLanguage }) {
  const t = gateVisitorEntryCopy(language), camera = useRef<CameraView>(null), mounted = useRef(false), pending = useRef(false);
  const [permission, requestPermission] = useCameraPermissions(), [ready, setReady] = useState(false), [pictureSize, setPictureSize] = useState<string>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const { active, capture } = useGateCameraLease(source);
  useScreenExitGuard({ blocked: busy });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setReady(false); }, [active, capture]);
  const cameraReady = async () => {
    const view = camera.current; if (!view || !active) return;
    let assertCurrent: () => void; try { assertCurrent = capture(); } catch { return; }
    try {
      const sizes = await view.getAvailablePictureSizesAsync(); assertCurrent();
      const values = sizes.map(value => ({ value, area: value.split('x').map(Number).reduce((a,b) => a*b,1), max: Math.max(...value.split('x').map(Number)) })).filter(value => Number.isFinite(value.area)).sort((a,b) => b.area-a.area);
      setPictureSize((values.find(value => value.max <= 1200) ?? values.at(-1))?.value); setReady(true);
    } catch { try { assertCurrent(); setReady(true); } catch { /* An old preview cannot become ready again. */ } }
  };
  const take = async () => {
    if (!active || !ready || pending.current || !camera.current) return;
    pending.current = true; setBusy(true); let uri = '';
    try {
      const assertCurrent = capture(), photo = await camera.current.takePictureAsync({ quality: .82, skipProcessing: false });
      // Expo returns an app-cache file. Own it before any post-await guard.
      uri = photo.uri; assertCurrent();
      const file = await readPrivateFile(uri, GATE_PHOTO_MAX_BYTES); assertCurrent();
      const metadata = gatePhotoMetadata('image/jpeg', file.size, file.bytes), hash = Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, file.bytes)), value => value.toString(16).padStart(2,'0')).join('');
      assertCurrent(); onPhoto({ ...metadata, uri, hash }); uri = ''; onClose();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : t.photoFailed); }
    finally { if (uri) await removePrivateFile(uri).catch(() => {}); pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <Section title={t.photo}><ScreenBack title={t.backEntry} priority={30} onPress={onClose} preservesDraft/>
    {!active ? <Notice message={t.cameraPaused}/> : permission?.granted ? <><View style={{ height: 320, borderRadius: 20, overflow: 'hidden' }}><CameraView ref={camera} style={{ flex: 1 }} facing="back" pictureSize={pictureSize} onCameraReady={() => void cameraReady()}/></View><ControlButton title={t.capture} kind="primary" busy={busy} disabled={!ready || busy} onPress={() => void take()}/></> : <><Notice message={t.cameraNotice}/><ControlButton title={permission?.canAskAgain === false ? t.settings : t.allow} onPress={() => { if (permission?.canAskAgain === false) void Linking.openSettings(); else { const assertCurrent = capture(); void requestPermission().then(() => assertCurrent()).catch(cause => { if (mounted.current) setError(cause instanceof Error ? cause.message : t.cameraUnavailable); }); } }}/></>}
    {error ? <Notice tone="warning" message={error}/> : null}<ControlButton title={t.close} disabled={busy} onPress={onClose}/>
  </Section>;
}
