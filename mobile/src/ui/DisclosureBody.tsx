import { View } from 'react-native';
import type { PropsWithChildren } from 'react';

export function DisclosureBody({ open, children }: PropsWithChildren<{ open: boolean }>) {
  return <View style={open ? { gap: 8 } : { display: 'none' }} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}>{children}</View>;
}
