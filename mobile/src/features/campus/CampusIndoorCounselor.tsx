import { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SCENE_PLACE_KIND_LABELS, type ScenePlaceKind } from '../../../../packages/contracts/src/campus-scenes/scenePlaceProposals';
import { CAMPUS_A2UI_BASIC_CATALOG } from '../../lib/campus-a2ui';
import { Button, Field, Notice } from '../../ui/components';
import { ChoiceMenu, ControlButton, Disclosure } from '../../ui/DomainControls';
import { useTheme } from '../../ui/theme';
import { CampusA2uiSurface, type CampusA2uiActionMessage } from './CampusA2uiSurface';

export type CampusIndoorPin = { roomId: string; itemId?: string };
export type CampusIndoorItemReview = {
  id: string;
  name: string;
  quantity: number | null;
  pinned?: boolean;
  quantityLocked?: boolean;
  category?: 'fixture' | 'resource' | 'opening';
};
export type CampusIndoorRoomReview = {
  id: string;
  name: string;
  kind: ScenePlaceKind | null;
  pinned?: boolean;
  linked?: boolean;
  items: readonly CampusIndoorItemReview[];
};
export type CampusIndoorPrompt = { id: string; question: string; hint?: string; optional?: boolean };

interface CampusIndoorCounselorProps {
  floorName: string;
  answer: string;
  onAnswerChange: (answer: string) => void;
  prompt?: CampusIndoorPrompt;
  onAnswer: (answer: string) => void | Promise<void>;
  onSkipPrompt?: () => void | Promise<void>;
  rooms: readonly CampusIndoorRoomReview[];
  onDescribeRoom?: (roomId: string) => void;
  onEditRoom: (roomId: string, changes: { name?: string; kind?: ScenePlaceKind }) => void;
  onEditItem?: (roomId: string, itemId: string, changes: { name?: string; quantity?: number | null }) => void;
  activePin?: CampusIndoorPin | null;
  onPin: (pin: CampusIndoorPin | null) => void;
  canSave: boolean;
  onSave: () => void | Promise<void>;
  onPause: () => void | Promise<void>;
  disabled?: boolean;
  busy?: boolean;
}

const ANSWER_PATH = '/answer';
const FIRST_QUESTION: CampusIndoorPrompt = {
  id: 'describe-floor',
  question: 'What rooms and equipment are on this floor?',
  hint: 'Give room names or counts. Include doors, furniture or equipment where you know them.',
};
const ROOM_KINDS: readonly ScenePlaceKind[] = ['classroom', 'laboratory', 'library', 'office', 'staff_room', 'workshop', 'residential_room', 'other'];
const ROOM_OPTIONS = ROOM_KINDS.map(value => ({ value, label: SCENE_PLACE_KIND_LABELS[value] ?? value }));

function questionMessages(prompt: CampusIndoorPrompt, answer: string, canSkip: boolean) {
  const binding = { '@path': ANSWER_PATH };
  return [
    {
      version: '1.0',
      createSurface: {
        surfaceId: `indoor-question-${prompt.id}`, catalogId: CAMPUS_A2UI_BASIC_CATALOG, dataModel: { answer },
        components: [
          { id: 'root', component: 'Column', children: ['question', ...(prompt.hint ? ['hint'] : []), 'answer', 'continue', ...(canSkip ? ['skip'] : [])] },
          { id: 'question', component: 'Text', text: `## ${prompt.question}` },
          ...(prompt.hint ? [{ id: 'hint', component: 'Text', text: prompt.hint, variant: 'caption' }] : []),
          {
            id: 'answer', component: 'TextField', variant: 'longText', label: 'Your description', value: binding,
            placeholder: 'Two classrooms and an office. The office has one printer and two desks.',
          },
          {
            id: 'continue', component: 'Button', child: 'continue-label', variant: 'primary',
            action: { event: { name: 'answer_indoor_question', context: { answer: binding } } },
          },
          { id: 'continue-label', component: 'Text', text: 'Review description' },
          ...(canSkip ? [
            { id: 'skip', component: 'Button', child: 'skip-label', variant: 'borderless', action: { event: { name: 'skip_indoor_question' } } },
            { id: 'skip-label', component: 'Text', text: 'Skip this question' },
          ] : []),
        ],
      },
    },
  ];
}

export function CampusIndoorCounselor(props: CampusIndoorCounselorProps) {
  const { colors } = useTheme();
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const pending = useRef(false);
  const locked = props.disabled || props.busy || working;
  const prompt = props.prompt ?? (!props.rooms.length ? FIRST_QUESTION : undefined);
  const canSkip = prompt?.optional === true && !!props.onSkipPrompt;
  const messages = useMemo(() => prompt ? questionMessages(prompt, props.answer, canSkip) : [], [prompt, props.answer, canSkip]);
  const pinRoom = props.rooms.find(room => room.id === props.activePin?.roomId);
  const pinItem = pinRoom?.items.find(item => item.id === props.activePin?.itemId);
  const pinName = props.activePin?.itemId ? pinItem?.name : pinRoom?.name;

  const run = async (action: () => void | Promise<void>) => {
    if (locked || pending.current) return;
    pending.current = true;
    setWorking(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This action could not be completed. Your changes are still here.');
    } finally {
      pending.current = false;
      setWorking(false);
    }
  };
  const handleAction = ({ action }: CampusA2uiActionMessage) => {
    if (locked || pending.current) return;
    if (action.name === 'skip_indoor_question' && canSkip && props.onSkipPrompt) {
      void run(props.onSkipPrompt);
    } else if (action.name === 'answer_indoor_question') {
      const answer = typeof action.context.answer === 'string' ? action.context.answer.trim() : '';
      if (!answer) {
        setError('Describe one room or item to continue.');
        return;
      }
      void run(() => props.onAnswer(answer));
    }
  };

  return <View style={styles.guide}>
    <Text style={[styles.floor, { color: colors.muted }]}>{props.floorName}</Text>
    {error ? <Notice message={error} tone="warning" /> : null}
    {props.activePin ? <View style={styles.group}>
      <Text accessibilityRole="header" aria-level={2} style={[styles.heading, { color: colors.ink }]}>Place {pinName || 'this item'}</Text>
      <Text style={[styles.copy, { color: colors.muted }]}>Tap its location on the floor map.</Text>
      <ControlButton title="Cancel placement" disabled={locked} onPress={() => props.onPin(null)} />
    </View> : <>
      {prompt ? <CampusA2uiSurface messages={messages} disabled={locked} onAction={handleAction}
        onValueChange={(path, value) => {
          if (path === ANSWER_PATH && typeof value === 'string') props.onAnswerChange(value);
        }} /> : null}
      {props.rooms.length ? <View style={styles.group}>
        <Text accessibilityRole="header" aria-level={2} style={[styles.heading, { color: colors.ink }]}>Review the proposed floor</Text>
        <Text style={[styles.copy, { color: colors.muted }]}>Correct the room names, then place the rooms and items you know.</Text>
        {props.rooms.map((room, index) => <Disclosure key={room.id} title={room.name.trim() || 'Unnamed room'} defaultOpen={index === 0}>
          <Field label="Room name" value={room.name} editable={!locked} maxLength={160}
            onChangeText={name => props.onEditRoom(room.id, { name })} />
          {!room.linked ? <ChoiceMenu label="Room use" value={room.kind ?? ''} options={ROOM_OPTIONS} disabled={locked}
            onChange={kind => props.onEditRoom(room.id, { kind: kind as ScenePlaceKind })} /> : null}
          <ControlButton title={room.pinned ? 'Move room on floor' : 'Place room on floor'}
            disabled={locked || !room.name.trim()} onPress={() => props.onPin({ roomId: room.id })} />
          {props.onDescribeRoom ? <ControlButton title="Describe items here" disabled={locked || !room.name.trim()}
            onPress={() => props.onDescribeRoom?.(room.id)} /> : null}
          {room.items.map(item => <Disclosure key={item.id} title={itemTitle(item)}>
            {props.onEditItem ? <>
              <Field label={item.category === 'resource' ? 'Equipment name' : 'Item name'} value={item.name} editable={!locked} maxLength={160}
                onChangeText={name => props.onEditItem?.(room.id, item.id, { name })} />
              <Field label="Quantity (optional)" value={item.quantity === null ? '' : String(item.quantity)}
                editable={!locked && !item.quantityLocked} keyboardType="number-pad" inputMode="numeric" maxLength={3} onChangeText={value => {
                  if (!value || /^[1-9][0-9]{0,2}$/.test(value)) {
                    props.onEditItem?.(room.id, item.id, { quantity: value ? Number(value) : null });
                  }
                }} />
            </> : null}
            <ControlButton title={item.pinned ? 'Move item on floor' : 'Place item on floor'}
              disabled={locked || !room.pinned || !item.name.trim()} onPress={() => props.onPin({ roomId: room.id, itemId: item.id })} />
            {!room.pinned ? <Text style={[styles.copy, { color: colors.muted }]}>Place this room before adding its items.</Text> : null}
          </Disclosure>)}
        </Disclosure>)}
      </View> : null}
    </>}
    <View style={styles.group}>
      {props.canSave || props.rooms.length > 0 ? <Button title="Save floor draft" busy={props.busy || working} disabled={locked || !props.canSave || !!props.activePin}
        onPress={() => void run(props.onSave)} /> : null}
      <ControlButton title="Pause indoor setup" disabled={locked} onPress={() => void run(props.onPause)} />
    </View>
  </View>;
}

function itemTitle(item: CampusIndoorItemReview) {
  const name = item.name.trim() || 'Unnamed item';
  const quantity = item.quantity !== null && item.quantity > 1 ? ` · ${item.quantity}` : '';
  return `${name}${quantity}`;
}

const styles = StyleSheet.create({
  guide: { gap: 16 },
  group: { gap: 8 },
  floor: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  heading: { fontSize: 20, fontWeight: '600', lineHeight: 26 },
  label: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  copy: { fontSize: 14, lineHeight: 21 },
});
