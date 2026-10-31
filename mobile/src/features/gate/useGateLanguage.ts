import { useEffect, useRef, useState } from 'react';
import { useSession } from '../../auth/SessionProvider';
import { getApiOrigin } from '../../lib/api';
import { readGateLanguage, saveGateLanguage } from '../../lib/gate-language-storage';
import { gateLanguagePreferenceKey, type GateLanguage } from '../../lib/gate-operator-policy';

export function useGateLanguage(schoolId: string) {
  const { user } = useSession(), scope = { origin: getApiOrigin(), actorId: user?.id ?? '', schoolId };
  const key = gateLanguagePreferenceKey(scope), current = useRef({ key, revision: 0 }), [state, setState] = useState({ key, language: 'en' as GateLanguage, error: false });
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  if (current.current.key !== key) current.current = { key, revision: 0 };
  useEffect(() => {
    let alive = true; const revision = current.current.revision;
    void readGateLanguage(scope).then(language => { if (alive && current.current.key === key && current.current.revision === revision) setState({ key, language, error: false }); }).catch(() => { if (alive && current.current.key === key && current.current.revision === revision) setState({ key, language: 'en', error: true }); });
    return () => { alive = false; };
  }, [key]);
  const language = state.key === key ? state.language : 'en';
  const setLanguage = (next: GateLanguage) => {
    const revision = ++current.current.revision; setState({ key, language: next, error: false });
    void saveGateLanguage(scope, next).catch(() => { if (mounted.current && current.current.key === key && current.current.revision === revision) setState({ key, language: next, error: true }); });
  };
  return { language, setLanguage, preferenceError: state.key === key && state.error };
}
