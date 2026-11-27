import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  createScenePlaceProposals, SCENE_PLACE_KIND_LABELS, sceneProposalKinds, type ScenePlaceKind,
} from '../../../../packages/contracts/src/campus-scenes/scenePlaceProposals';
import type { CampusSceneDocument } from '../../../../packages/contracts/src/campus-scenes/types';
import { a2uiRecord, a2uiText, CAMPUS_A2UI_BASIC_CATALOG, campusA2uiAction, readCampusA2uiSurfaces } from '../../lib/campus-a2ui';
import type { CampusMapAssistance } from '../../lib/campus-map-assistance';
import { Button, Notice } from '../../ui/components';
import { ControlButton } from '../../ui/DomainControls';
import { Icon } from '../../ui/Icon';
import { useTheme } from '../../ui/theme';
import { CampusA2uiSurface, type CampusA2uiActionMessage } from './CampusA2uiSurface';

export type CampusMapReviewHint = { label: string; kind: [ScenePlaceKind] };
export type CampusMapReviewHints = Readonly<Record<string, CampusMapReviewHint>>;

interface ReviewStep {
  id: string;
  question: string;
  label: string;
  kind: ScenePlaceKind;
  allowedKinds: readonly ScenePlaceKind[];
}

const MAX_REVIEW_STEPS = 24;

function createSteps(assistance: CampusMapAssistance, document: CampusSceneDocument, initialHints: CampusMapReviewHints, interiors = false): ReviewStep[] {
  const elements = new Map(document.elements.map(element => [element.id, element]));
  const groups = createScenePlaceProposals(document, []);
  const byElement = new Map(groups.flatMap(group => group.elementIds.map(id => [id, group] as const)));
  const suggestions = new Map<string, { id: string; question: string; kind: unknown }>();
  for (const surface of readCampusA2uiSurfaces(assistance.messages) ?? []) {
    for (const component of surface.components.values()) {
      const action = campusA2uiAction(surface.id, component, surface.model, '')?.action;
      if (action?.name !== 'focus_feature' || typeof action.context.feature_id !== 'string') continue;
      const id = action.context.feature_id;
      const group = byElement.get(id);
      if (group?.category !== 'places' || suggestions.has(group.id)) continue;
      const question = a2uiText(surface.components.get(`${id}_question`)?.text, surface.model).trim();
      const hints = a2uiRecord(surface.model.hints) ? surface.model.hints : undefined;
      const value = hints?.[id];
      const seed = a2uiRecord(value) ? value : undefined;
      suggestions.set(group.id, { id, question, kind: Array.isArray(seed?.kind) ? seed.kind[0] : undefined });
    }
  }
  const ordered = [...suggestions.keys(), ...groups.filter(group => group.category === 'places' && !suggestions.has(group.id)).map(group => group.id)];
  const byGroup = new Map(groups.map(group => [group.id, group]));
  return ordered.flatMap(groupId => {
    const group = byGroup.get(groupId);
    if (!group || group.elementIds.some(id => Object.hasOwn(initialHints, id))) return [];
    const outlines = group.elementIds.flatMap(id => {
      const element = elements.get(id);
      return element && !element.floor_id && (!interiors || element.kind === 'building' && element.geometry.type === 'polygon') ? [element] : [];
    });
    const allowedKinds = sceneProposalKinds(outlines);
    const suggestion = suggestions.get(groupId);
    const feature = outlines.find(element => element.id === suggestion?.id) ?? outlines[0];
    const kind = allowedKinds.find(value => value === suggestion?.kind || (suggestion?.kind === undefined && value === group.kind)) ?? allowedKinds[0];
    return feature && kind ? [{
      id: feature.id, label: feature.label, kind, allowedKinds,
      question: suggestion?.question || (interiors ? 'What is this building called and how is it used?' : 'What is this place called and how is it used?'),
    }] : [];
  }).slice(0, MAX_REVIEW_STEPS);
}

export function canGuideCampusFacilities(assistance: CampusMapAssistance, document: CampusSceneDocument, initialHints: CampusMapReviewHints = {}): boolean {
  const hasConfirmedPlace = document.elements.some(element => {
    const hint = initialHints[element.id];
    return Object.hasOwn(initialHints, element.id) && !element.floor_id && !element.space_id && sceneProposalKinds([element]).includes(hint.kind[0]);
  });
  return hasConfirmedPlace || createSteps(assistance, document, initialHints).length > 0;
}

function stepMessages(step: ReviewStep, labelText: string) {
  const label = { '@path': '/facility/label' };
  const kind = { '@path': '/facility/kind' };
  return [{
    version: '1.0',
    createSurface: {
      surfaceId: `review-${step.id}`, catalogId: CAMPUS_A2UI_BASIC_CATALOG, dataModel: { facility: { label: step.label, kind: [step.kind] } },
      components: [
        { id: 'root', component: 'Column', children: ['question', 'name', 'kind', 'apply'] },
        { id: 'question', component: 'Text', text: `### ${step.question}` },
        { id: 'name', component: 'TextField', label: 'Place name', value: label },
        step.allowedKinds.length === 1
          ? { id: 'kind', component: 'Text', text: `Use: ${SCENE_PLACE_KIND_LABELS[step.kind] ?? step.kind}`, variant: 'caption' }
          : { id: 'kind', component: 'ChoicePicker', label: 'Place use', value: kind,
            options: step.allowedKinds.map(value => ({ value, label: SCENE_PLACE_KIND_LABELS[value] ?? value })) },
        { id: 'apply', component: 'Button', child: 'apply-label', variant: 'primary',
          action: { event: { name: 'accept_place_hint', context: { feature_id: step.id, label, kind } } } },
        { id: 'apply-label', component: 'Text', text: labelText },
      ],
    },
  }];
}

export function CampusMapAreaReview({ assistance, document, disabled, initialHints = {}, interiors = false, onFocus, onApply, onContinue, onClose }: {
  assistance: CampusMapAssistance;
  document: CampusSceneDocument;
  disabled: boolean;
  initialHints?: CampusMapReviewHints;
  interiors?: boolean;
  onFocus: (id: string) => void;
  onApply: (id: string, hint: CampusMapReviewHint) => void | Promise<void>;
  onContinue: (hints: CampusMapReviewHints) => void | Promise<void>;
  onClose?: () => void;
}) {
  const { colors } = useTheme();
  const [steps] = useState(() => createSteps(assistance, document, initialHints, interiors));
  const [answers, setAnswers] = useState<CampusMapReviewHints>(initialHints);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const pending = useRef(false);
  const focus = useRef(onFocus);
  focus.current = onFocus;
  const step = steps[index];
  const currentId = step?.id;
  useEffect(() => {
    if (currentId) focus.current(currentId);
  }, [currentId]);

  const saveOnApply = interiors || index === steps.length - 1;
  const applyLabel = interiors ? 'Connect building' : saveOnApply ? 'Save facilities' : 'Apply and next';
  // A stable message preserves unsaved input during a failed action retry.
  const messages = useMemo(() => step ? stepMessages(step, applyLabel) : [], [step, applyLabel]);

  const run = async (action: () => void | Promise<void>) => {
    if (disabled || pending.current) return;
    pending.current = true;
    setWorking(true);
    setError('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Facilities could not be saved. Try again.'); }
    finally { pending.current = false; setWorking(false); }
  };
  const act = ({ action }: CampusA2uiActionMessage) => {
    if (!step || action.name !== 'accept_place_hint' || action.context.feature_id !== step.id || disabled || pending.current) return;
    const label = typeof action.context.label === 'string' ? action.context.label.trim() : '';
    const choice = action.context.kind;
    const kind = Array.isArray(choice) && choice.length === 1 ? step.allowedKinds.find(value => value === choice[0]) : undefined;
    if (label.length < 2 || label.length > 160 || !kind) {
      setError('Enter a place name and choose its use.');
      return;
    }
    const next: CampusMapReviewHints = { ...answers, [step.id]: { label, kind: [kind] } };
    void run(async () => {
      if (answers[step.id]?.label !== label || answers[step.id]?.kind[0] !== kind) {
        await onApply(step.id, next[step.id]!);
        setAnswers(next);
      }
      if (saveOnApply) await onContinue(next);
      else setIndex(previous => previous + 1);
    });
  };
  const locked = disabled || working;
  const answered = Object.keys(answers).length;
  return <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
    <View style={styles.header}>
      <Text accessibilityLiveRegion="polite" style={[styles.progress, { color: colors.muted }]}>
        {working && (!step || saveOnApply) ? interiors ? 'Connecting building…' : 'Saving facilities…'
          : step ? `${interiors ? 'Building' : 'Place'} ${index + 1} of ${steps.length}`
          : answered ? 'Facilities ready to save' : interiors ? 'Identify a building' : 'Identify facilities'}
      </Text>
      {onClose ? <Pressable accessibilityRole="button" accessibilityLabel="Close facilities review"
        accessibilityState={{ disabled: locked }} disabled={locked} onPress={onClose}
        style={({ pressed }) => [styles.close, { opacity: locked ? .5 : pressed ? .65 : 1 }]}>
        <Icon name="close" size={21} />
      </Pressable> : null}
    </View>
    {error ? <Notice message={error} tone="warning" /> : null}
    {step ? <>
      <CampusA2uiSurface messages={messages} onAction={act} disabled={locked} />
      {!Object.hasOwn(answers, step.id) ? <ControlButton title={interiors ? 'Skip building' : 'Skip place'} disabled={locked} onPress={() => { setError(''); setIndex(previous => previous + 1); }} /> : null}
    </> : <View style={styles.finished}>
      <Text style={[styles.description, { color: colors.ink }]}>
        {answered ? 'Save the places you confirmed on the layout.' : 'No places are ready to save. You can still edit the layout.'}
      </Text>
      {answered ? <Button title="Save facilities" busy={working} disabled={disabled} onPress={() => void run(() => onContinue(answers))} /> : null}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { paddingHorizontal: 16, paddingBottom: 8, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  progress: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  finished: { gap: 12, paddingBottom: 8 },
  description: { fontSize: 16, lineHeight: 23 },
});
