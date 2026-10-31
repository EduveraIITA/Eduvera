import React, { Component, useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { WithSkiaWeb } from 'react-native-skia/lib/module/web';
import { Empty, Loading } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import type { CampusMapCanvasProps } from './CampusMapCanvas.types';
import { prepareCampusSkiaWeb } from './skia/campusSkiaWebBootstrap';

export { initialCampusCamera, type CampusCamera } from '../../lib/campus-camera';
export type { CampusMapCanvasProps } from './CampusMapCanvas.types';

const loadMap = () => import('./skia/CampusSkiaMap');
const loading = <View style={{ flex: 1, padding: 20, justifyContent: 'center' }}><Loading label="Preparing campus view…" /></View>;

class CampusGraphicsBoundary extends Component<{ children: ReactNode; onRetry(): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <View style={{ padding: 20 }}><Empty title="Campus view could not open" message="Try again to reload the map. Your campus data is unchanged." onRetry={this.props.onRetry} /></View> : this.props.children;
  }
}

/** Skia-importing code loads only after the matching local CanvasKit is ready. */
export function CampusMapCanvas(props: CampusMapCanvasProps) {
  const { colors } = useTheme();
  const [attempt, setAttempt] = useState(0), [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let active = true;
    setStatus('loading');
    void prepareCampusSkiaWeb().then(() => { if (active) setStatus('ready'); }, () => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [attempt]);
  const retry = () => { setStatus('loading'); setAttempt(value => value + 1); };
  return <View style={{ flex: 1, minWidth: 0, minHeight: 0, alignSelf: 'stretch', backgroundColor: colors.canvas }}>
    {status === 'loading' ? loading : status === 'error' ? <View style={{ padding: 20 }}><Empty title="Campus view could not load" message="Check your connection and try again." onRetry={retry} /></View> : <CampusGraphicsBoundary key={attempt} onRetry={retry}>
      <WithSkiaWeb getComponent={loadMap} componentProps={props} fallback={loading} />
    </CampusGraphicsBoundary>}
  </View>;
}
