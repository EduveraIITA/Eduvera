import { useEffect } from 'react';
import { useIsFocused } from 'expo-router';
import { useAssistantPresentation } from './AssistantPresentation';
import { Button, Notice, Page } from './components';

/** Canonical URL adapter and honest retry surface, never a second body. A
 * declined student-change confirmation keeps the retained draft recoverable. */
export function AssistantRouteActivation({ href }: { href: string }) {
  const focused = useIsFocused(), presentation = useAssistantPresentation();
  useEffect(() => { if (focused) presentation.openCanonical(href); },[focused,href,presentation.active,presentation.href]);
  return <Page title="Assistant"><Notice message="Assistant opens over your workspace. The linked conversation can be opened here; its current account access and saved history are checked first." />{!presentation.active ? <Button title="Open linked conversation" onPress={() => presentation.requestCanonical(href)} /> : null}</Page>;
}
