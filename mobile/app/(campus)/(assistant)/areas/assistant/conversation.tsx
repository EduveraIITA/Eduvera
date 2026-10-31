import { useLocalSearchParams } from 'expo-router';
import { nativeRouteHref } from '../../../../../src/lib/route-state';
import { AssistantRouteActivation } from '../../../../../src/ui/AssistantRouteActivation';
/** Canonical URL adapter only. The campus root owns the one mounted body. */
export default function Conversation() {
  const params = useLocalSearchParams<Record<string,string | string[] | undefined>>();
  const { href } = nativeRouteHref('areas',{ ...params,path: ['assistant','conversation'] });
  return <AssistantRouteActivation href={href} />;
}
