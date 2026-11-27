import type { CampusSceneDocument } from '../../../../packages/contracts/src/campus-scenes/types';
import type { CampusMapAssistance } from '../../lib/campus-map-assistance';
import { Button, Notice, Section, usePageScroll } from '../../ui/components';
import { CampusA2uiSurface, type CampusA2uiActionMessage } from './CampusA2uiSurface';

export function CampusMapAreaReview({ assistance, document, disabled, onFocus, onApply, onContinue }: {
  assistance: CampusMapAssistance;
  document: CampusSceneDocument;
  disabled: boolean;
  onFocus: (id: string) => void;
  onApply: (id: string, hint: unknown) => void;
  onContinue: (hints: unknown) => void;
}) {
  const scrollToTop = usePageScroll();
  const act = ({ action }: CampusA2uiActionMessage) => {
    if (disabled) return;
    const { name, context } = action;
    if (name === 'review_places') {
      onContinue(context.hints);
      return;
    }
    const id = context.feature_id;
    if (typeof id !== 'string' || !document.elements.some(element => element.id === id)) return;
    if (name === 'focus_feature') {
      onFocus(id);
      scrollToTop();
    } else if (name === 'accept_place_hint') {
      onApply(id, context);
    }
  };

  return <Section title="Identify campus places">
    {assistance.status === 'simulation'
      ? <Notice message="This draft uses the practice campus in your Simulation." />
      : assistance.status === 'map_only'
        ? <Notice message="AI suggestions were unavailable. You can name and connect the mapped features here." />
        : <Notice message="Check suggested names and types against your campus before connecting places." />}
    {document.source.attribution ? <Notice message={document.source.attribution} /> : null}
    <CampusA2uiSurface messages={assistance.messages} onAction={act} disabled={disabled}
      fallback={<Button title="Continue to place review" disabled={disabled} onPress={() => onContinue(undefined)} />} />
  </Section>;
}
