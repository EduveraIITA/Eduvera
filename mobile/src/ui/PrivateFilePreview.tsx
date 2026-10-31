import { useEffect, useState } from 'react';
import { Image } from 'react-native';
import { privateFilePreview } from '../lib/private-file';
import { Loading, Notice } from './components';

/** Resolve a selected/staged private handle without exposing a remote URL. */
export function PrivateFilePreview({ uri, label }: { uri: string; label: string }) {
  const [preview, setPreview] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    let active = true, release: (() => void) | undefined; setPreview(''); setError('');
    void privateFilePreview(uri).then(value => { if (!active) { value.release(); return; } release = value.release; setPreview(value.uri); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'This private preview is unavailable.'); });
    return () => { active = false; release?.(); };
  }, [uri]);
  return error ? <Notice tone="warning" message={error} /> : preview ? <Image source={{ uri: preview }} style={{ height: 220, width: '100%', borderRadius: 16 }} resizeMode="contain" accessibilityLabel={label} /> : <Loading />;
}
