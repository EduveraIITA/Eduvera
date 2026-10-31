import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';
import { resolveSceneLighting } from '../../../packages/contracts/src/campus-scenes/sceneLighting';
import { resolveSceneSunlight } from '../../../packages/contracts/src/campus-scenes/sceneSunlight';
import { useSession } from '../auth/SessionProvider';
import { useTheme } from '../ui/theme';
import { nativeCampusSceneInstant } from './native-campus';

/** Match the web illustration's campus-local lighting without advancing a world clock. */
export function useNativeSceneLighting(timeZone?: string) {
  const { environment } = useSession(), { preference, dark } = useTheme(), focused = useIsFocused();
  const [liveInstant, setLiveInstant] = useState(() => new Date());
  useEffect(() => {
    if (!focused || environment.mode !== 'live') return;
    const update = () => { if (AppState.currentState === 'active') setLiveInstant(new Date()); };
    update();
    const interval = setInterval(update, 30_000), subscription = AppState.addEventListener('change', update);
    return () => { clearInterval(interval); subscription.remove(); };
  }, [focused, environment.mode]);
  return useMemo(() => {
    const instant = nativeCampusSceneInstant(environment, liveInstant);
    const value = resolveSceneLighting(preference, dark ? 'dark' : 'light', instant, timeZone ?? environment.virtual_clock?.time_zone);
    return { ...value, sunlight: resolveSceneSunlight(value.lighting, value.localHour) };
  }, [preference, dark, liveInstant, environment.mode, environment.unavailable, environment.virtual_clock?.now, environment.virtual_clock?.time_zone, timeZone]);
}
