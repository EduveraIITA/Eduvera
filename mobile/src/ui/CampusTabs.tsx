import { Tabs } from 'expo-router';
import { campusTabs } from '../lib/campus-tabs';
import { useTheme } from './theme';
import type { CampusTabsProps } from './CampusTabs.types';
/** Browser/Android retain their current shell controls until the final platform pass. */
export function CampusTabs(_props: CampusTabsProps) {
  const { colors } = useTheme();
  return <Tabs backBehavior="fullHistory" detachInactiveScreens={false} screenOptions={{ headerShown: false,sceneStyle: { backgroundColor: colors.canvas } }} tabBar={() => null}>{campusTabs.map(item => <Tabs.Screen key={item.name} name={item.name} />)}</Tabs>;
}
