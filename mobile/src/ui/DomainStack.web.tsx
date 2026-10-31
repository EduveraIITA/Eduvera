import { Stack } from 'expo-router';
import { useTheme } from './theme';

/** The web shell owns the single institution header and browser navigation. */
export function DomainStack() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />;
}
