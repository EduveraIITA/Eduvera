import { NativeTabs } from 'expo-router/native-tabs';
import { campusTabs } from '../lib/campus-tabs';
import { useTheme } from './theme';
import type { CampusTabsProps } from './CampusTabs.types';
const icons = {
  light: { today: require('../../assets/today-tab-light.png'),work: require('../../assets/work-tab-light.png'),areas: require('../../assets/areas-tab-light.png'),more: require('../../assets/more-tab-light.png') },
  dark: { today: require('../../assets/today-tab-dark.png'),work: require('../../assets/work-tab-dark.png'),areas: require('../../assets/areas-tab-dark.png'),more: require('../../assets/more-tab-dark.png') },
};
/** UIKit owns the tab surfaces, selected lens and transitions. The Assistant is
 * an action on iOS 27's prominent tab surface: native selection is prevented
 * so its bubble opens over the current operating page instead of replacing it. */
export function CampusTabs(props: CampusTabsProps) {
  const { colors,dark } = useTheme();
  return <NativeTabs backBehavior="history" activityEnabled={false} hidden={props.hidden || props.sidebar} sidebarAdaptable={false} minimizeBehavior="never" tintColor={colors.link} labelStyle={{ default: { color: colors.ink,fontSize: 11 },selected: { color: colors.link,fontSize: 11 } }} badgeBackgroundColor={colors.danger}>
    {campusTabs.map(item => <NativeTabs.Trigger key={item.name} name={item.name} hidden={item.name === '(assistant)' && !props.assistant} disabled={item.name === '(assistant)' || props.blocked} prominent={item.name === '(assistant)'} disablePopToTop disableScrollToTop listeners={{ tabPress: event => {
      if (item.name === '(assistant)') { if (!props.blocked && props.assistant) props.onAssistantPress(); }
      else if (event.data.isPrevented || props.activeRoot === item.href) props.onTabPress(item.href);
    } }}>
      <NativeTabs.Trigger.Icon src={item.name === '(assistant)' ? dark ? require('../../assets/assistant-tab-dark.png') : require('../../assets/assistant-tab-light.png') : icons[dark ? 'dark' : 'light'][item.name]} renderingMode="original" />
      <NativeTabs.Trigger.Label hidden={item.name === '(assistant)'}>{item.label}</NativeTabs.Trigger.Label>
      {item.name === 'work' && props.workCount > 0 ? <NativeTabs.Trigger.Badge>{props.workCount > 99 ? '99+' : String(props.workCount)}</NativeTabs.Trigger.Badge> : null}
    </NativeTabs.Trigger>)}
  </NativeTabs>;
}
