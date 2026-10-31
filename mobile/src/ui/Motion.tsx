import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, LayoutAnimation, Modal, Platform, type ModalProps } from 'react-native';

const ReducedMotion = createContext(true);

/** One live system preference; unknown/failed reads use the still presentation. */
export function MotionProvider({ children }: PropsWithChildren) {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let mounted = true, changed = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { changed = true; if (mounted) setReduced(value); });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted && !changed) setReduced(value); }).catch(() => {});
    return () => { mounted = false; subscription.remove(); };
  }, []);
  return <ReducedMotion.Provider value={reduced}>{children}</ReducedMotion.Provider>;
}

export function useReducedMotion() { return useContext(ReducedMotion); }

/** Animate only a person's disclosure change, never incoming data or action results. */
export function useDisclosureMotion() {
  const reduced = useReducedMotion();
  return () => {
    if (!reduced && Platform.OS !== 'web') LayoutAnimation.configureNext({ duration: 180, update: { type: 'easeInEaseOut' }, create: { type: 'easeOut', property: 'opacity' } });
  };
}

export function MotionModal(props: ModalProps) {
  const reduced = useReducedMotion();
  return <Modal {...props} animationType={reduced ? 'none' : props.animationType} />;
}
