import { useLayoutEffect, useRef, useState, type ComponentRef } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import { copilotIndicator, measureCopilotTarget, type CopilotRect } from '../lib/copilot-target';
import { AssistantMark } from './AssistantMark';
import { useCopilot } from './CopilotProvider';
import { useReducedMotion } from './Motion';
import { useTheme } from './theme';

export function CopilotPointer({ enabled }: { enabled: boolean }) {
  const { pointer } = useCopilot();
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const host = useRef<ComponentRef<typeof View>>(null);
  const [frame, setFrame] = useState<CopilotRect>();
  const position = useRef(new Animated.ValueXY()).current;
  const hasPosition = useRef(false);
  const indicator = enabled && pointer && frame ? copilotIndicator(pointer.rect, frame) : undefined;
  const x = indicator?.x, y = indicator?.y;

  useLayoutEffect(() => {
    const node = host.current;
    if (!enabled || !pointer || !node) return;
    const controller = new AbortController();
    void measureCopilotTarget(node, controller.signal).then(value => {
      if (value && !controller.signal.aborted) setFrame(value);
    });
    return () => controller.abort();
  }, [enabled, pointer]);

  useLayoutEffect(() => {
    if (!enabled) hasPosition.current = false;
    if (x === undefined || y === undefined) return;
    if (!hasPosition.current || reduced) {
      position.setValue({ x, y });
      hasPosition.current = true;
      return;
    }
    const animation = Animated.spring(position, {
      toValue: { x, y }, stiffness: 340, damping: 34, mass: 0.8,
      overshootClamping: true, isInteraction: false, useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [enabled, x, y, reduced, position]);

  return <View ref={host} collapsable={false} pointerEvents="none" accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" aria-hidden style={styles.host}>
    {indicator?.outline ? <View style={[styles.outline, indicator.outline, { borderColor: colors.link }]} /> : null}
    {indicator ? <Animated.View testID="copilot-pointer" style={[styles.badge, {
      backgroundColor: colors.surface, borderColor: colors.link, transform: position.getTranslateTransform(),
    }]}>
      <View style={[styles.tip, indicator.below ? styles.tipUp : styles.tipDown,
        { backgroundColor: colors.surface, borderColor: colors.link }]} />
      <AssistantMark size={28} />
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  host: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 60, overflow: 'hidden' },
  badge: {
    position: 'absolute', left: 0, top: 0, height: 36, width: 36, borderRadius: 18,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  outline: { position: 'absolute', borderWidth: 1.5, borderRadius: 8 },
  tip: { position: 'absolute', width: 7, height: 7, left: 13.5, transform: [{ rotate: '45deg' }] },
  tipUp: { top: -4, borderLeftWidth: 1, borderTopWidth: 1 },
  tipDown: { bottom: -4, borderRightWidth: 1, borderBottomWidth: 1 },
});
