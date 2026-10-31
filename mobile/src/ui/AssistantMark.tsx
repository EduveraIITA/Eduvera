import React, { useContext, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Platform, StyleSheet, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from './theme';
import { useReducedMotion } from './Motion';
import { AssistantOverlayActivityContext } from './assistant-overlay-context';
import { assistantBrand as brand, assistantTracks, brandFeatherColor, brandMotionAllowed, loadingFeatherScale, sampledAssistantTrack } from './assistant-brand';

const assistantSamples = assistantTracks.map(sampledAssistantTrack);
const loadingTimes = Array.from({ length: 257 }, (_,frame) => frame/256);
const loadingSamples = Array.from({ length: 8 }, (_,feather) => {
  const scales = loadingTimes.map(phase => loadingFeatherScale(phase,feather));
  return { x: scales.map(scale => scale.x), y: scales.map(scale => scale.y) };
});

function useBrandAnimation(duration: number) {
  const focused = useIsFocused(), phase = useRef(new Animated.Value(0)).current;
  const overlayActive = useContext(AssistantOverlayActivityContext);
  const reduced = useReducedMotion();
  const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => {
    const state = AppState.addEventListener('change', setAppState);
    return () => { state.remove(); };
  }, []);
  const animated = brandMotionAllowed(reduced,focused,appState,overlayActive);
  useEffect(() => {
    phase.setValue(0);
    if (!animated) return;
    const loop = Animated.loop(Animated.timing(phase, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web', isInteraction: false }));
    loop.start();
    return () => { loop.stop(); phase.stopAnimation(); phase.setValue(0); };
  }, [animated,duration,phase]);
  return { animated, phase };
}

function StillMark({ size, feather }: { size: number; feather: string }) {
  return <Svg accessible={Platform.OS === 'web' ? undefined : false} aria-hidden={Platform.OS === 'web' ? true : undefined} width={size} height={size} viewBox={brand.viewBox}>
    {brand.feathers.map((path,index) => <Path key={index} d={path} fill={feather} />)}
    <Circle cx={768} cy={657} r={83} fill={brand.dot} />
  </Svg>;
}

/** Original supplied mark; only native transforms adapt the browser SVG motion. */
export function AssistantMark({ size = 64 }: { size?: number }) {
  const { dark } = useTheme(), { animated, phase } = useBrandAnimation(brand.assistantDuration);
  const feather = brandFeatherColor(dark);
  const anchors = [[-104,50,45],[0,-10,0],[104,50,-45]];
  return <View accessible accessibilityRole="image" accessibilityLabel="ThatCampus Assistant" style={{ width: size, height: size, flexShrink: 0 }}>
    {!animated ? <StillMark size={size} feather={feather} /> : <>
      {brand.feathers.map((path,index) => {
        const [x,y,axis] = anchors[index], dx = x/640*size, dy = y/640*size;
        const turn = assistantSamples[index*2], blink = assistantSamples[index*2+1];
        return <Animated.View key={index} style={[StyleSheet.absoluteFill, { transform: [
          { translateX: dx }, { translateY: dy },
          { rotate: phase.interpolate({ ...turn, outputRange: turn.outputRange.map(value => `${value}deg`) }) },
          { rotate: `${axis}deg` }, { scaleY: phase.interpolate(blink) }, { rotate: `${-axis}deg` },
          { translateX: -dx }, { translateY: -dy },
        ] }]}><Svg accessible={Platform.OS === 'web' ? undefined : false} aria-hidden={Platform.OS === 'web' ? true : undefined} width={size} height={size} viewBox={brand.viewBox}><Path d={path} fill={feather} /></Svg></Animated.View>;
      })}
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: 145/640*size }, { scale: phase.interpolate(assistantSamples[6]) }, { translateY: -145/640*size }] }]}>
        <Svg accessible={Platform.OS === 'web' ? undefined : false} aria-hidden={Platform.OS === 'web' ? true : undefined} width={size} height={size} viewBox={brand.viewBox}><Circle cx={768} cy={657} r={83} fill={brand.dot} /></Svg>
      </Animated.View>
    </>}
  </View>;
}

/** Decorative busy glyph: the owning status/button supplies its accessible name. */
export function BrandLoadingIcon({ size = 18, onFilledAction = false }: { size?: number; onFilledAction?: boolean }) {
  const { dark } = useTheme(), { animated, phase } = useBrandAnimation(brand.loadingDuration);
  const feather = brandFeatherColor(dark,onFilledAction);
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, flexShrink: 0 }}>
    {!animated ? <StillMark size={size} feather={feather} /> : <>
      {loadingSamples.map((scale,index) => <View key={index} style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${index*45}deg` }] }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: -62/428*size },
          { scaleX: phase.interpolate({ inputRange: loadingTimes, outputRange: scale.x }) },
          { scaleY: phase.interpolate({ inputRange: loadingTimes, outputRange: scale.y }) }, { translateY: 62/428*size }] }]}>
          <Svg accessible={Platform.OS === 'web' ? undefined : false} aria-hidden={Platform.OS === 'web' ? true : undefined} width={size} height={size} viewBox="-214 -214 428 428"><Path d={brand.loadingFeather} fill={feather} /></Svg>
        </Animated.View>
      </View>)}
      <Svg accessible={Platform.OS === 'web' ? undefined : false} aria-hidden={Platform.OS === 'web' ? true : undefined} width={size} height={size} viewBox="-214 -214 428 428"><Circle r={43} fill={brand.dot} /></Svg>
    </>}
  </View>;
}
