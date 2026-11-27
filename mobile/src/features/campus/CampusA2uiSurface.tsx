import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  a2uiBindingPath, a2uiRecord, a2uiText, campusA2uiAction, campusA2uiChildren,
  readCampusA2uiSurfaces, resolveA2uiValue, writeA2uiValue,
  type CampusA2uiActionMessage, type CampusA2uiSurfaceState,
} from '../../lib/campus-a2ui';
import { Button, Field, Notice } from '../../ui/components';
import { ChoiceMenu, ControlButton } from '../../ui/DomainControls';
import { useTheme } from '../../ui/theme';

export type { CampusA2uiActionMessage } from '../../lib/campus-a2ui';

interface CampusA2uiSurfaceProps {
  messages: readonly unknown[];
  onAction: (action: CampusA2uiActionMessage) => void;
  disabled?: boolean;
  fallback?: ReactNode;
}

export function CampusA2uiSurface({ messages, onAction, disabled, fallback }: CampusA2uiSurfaceProps) {
  const surfaces = useMemo(() => readCampusA2uiSurfaces(messages), [messages]);
  if (!surfaces?.length) return fallback ?? (surfaces ? null : <Notice tone="warning" message="The setup assistant could not load. You can continue in the campus editor." />);
  return surfaces.map(surface => <MapAssistanceSurface key={surface.id} surface={surface} onAction={onAction} disabled={disabled} />);
}

function MapAssistanceSurface({ surface, onAction, disabled }: Pick<CampusA2uiSurfaceProps, 'onAction' | 'disabled'> & { surface: CampusA2uiSurfaceState }) {
  const { colors } = useTheme();
  const [local, setLocal] = useState(() => ({ source: surface.model, model: surface.model }));
  const model = local.source === surface.model ? local.model : surface.model;
  const change = (path: string, value: string | string[]) => {
    if (disabled) return;
    setLocal(current => ({ source: surface.model, model: writeA2uiValue(current.source === surface.model ? current.model : surface.model, path, value) }));
  };

  const render = (id: string): ReactNode => {
    const component = surface.components.get(id);
    if (!component) return null;
    switch (component.component) {
      case 'Column':
      case 'Row':
        return <View key={id} style={component.component === 'Column' ? styles.column : styles.row}>{campusA2uiChildren(component)?.map(render)}</View>;
      case 'Card':
        return <View key={id} style={[styles.card, { backgroundColor: colors.surfaceSoft, borderColor: colors.border }]}>{render(String(component.child))}</View>;
      case 'Divider':
        return <View key={id} style={[component.axis === 'vertical' ? styles.verticalDivider : styles.divider, { backgroundColor: colors.border }]} />;
      case 'Text': {
        const text = a2uiText(component.text, model);
        const heading = /^(#{1,6})\s+([^\n]+)$/.exec(text);
        const caption = component.variant === 'caption';
        return <Text key={id} accessibilityRole={heading ? 'header' : undefined} aria-level={heading ? Math.max(2, heading[1].length) : undefined}
          style={[heading ? styles.heading : caption ? styles.caption : styles.text, { color: caption ? colors.muted : colors.ink }]}>
          {heading?.[2] ?? text}
        </Text>;
      }
      case 'TextField': {
        const label = a2uiText(component.label, model);
        const path = a2uiBindingPath(component.value);
        if (!label || !path || (component.variant !== undefined && component.variant !== 'shortText')) return null;
        return <Field key={id} label={label} placeholder={a2uiText(component.placeholder, model)}
          value={a2uiText(component.value, model)} maxLength={160} editable={!disabled}
          autoCapitalize="words" onChangeText={value => change(path, value)} />;
      }
      case 'ChoicePicker': {
        const label = a2uiText(component.label, model);
        const path = a2uiBindingPath(component.value);
        if (!label || !path || !Array.isArray(component.options) || component.options.length > 32
          || (component.variant !== undefined && component.variant !== 'mutuallyExclusive')) return null;
        const selected = resolveA2uiValue(component.value, model);
        const options = new Map<string, string>();
        for (const option of component.options) {
          if (!a2uiRecord(option) || typeof option.value !== 'string' || !option.value) continue;
          const optionLabel = a2uiText(option.label, model);
          if (optionLabel) options.set(option.value, optionLabel);
        }
        return <View key={id} style={styles.choice}>
          <Text style={[styles.caption, { color: colors.ink }]}>{label}</Text>
          <ChoiceMenu label={label} value={Array.isArray(selected) && typeof selected[0] === 'string' ? selected[0] : ''}
            options={[...options].map(([value, label]) => ({ value, label }))}
            disabled={disabled || !options.size} onChange={value => change(path, [value])} />
        </View>;
      }
      case 'Button': {
        const labelComponent = surface.components.get(String(component.child));
        const title = a2uiText(labelComponent?.text, model);
        if (!title || !campusA2uiAction(surface.id, component, model, '')) return null;
        const press = () => {
          if (disabled) return;
          const action = campusA2uiAction(surface.id, component, model);
          if (action) onAction(action);
        };
        if (component.variant === 'borderless') return <ControlButton key={id} title={title} onPress={press} disabled={disabled} />;
        return <Button key={id} title={title} kind={component.variant === 'primary' ? 'primary' : 'secondary'} onPress={press} disabled={disabled} />;
      }
    }
  };
  return render('root');
}

const styles = StyleSheet.create({
  column: { gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 24, padding: 16 },
  choice: { gap: 8 },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  text: { fontSize: 16, lineHeight: 23 },
  caption: { fontSize: 14, lineHeight: 20 },
  divider: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  verticalDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
});
