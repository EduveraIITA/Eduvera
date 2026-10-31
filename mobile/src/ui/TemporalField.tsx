import { useState } from 'react';
import { Platform, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { browserCalendarDay } from '../lib/browser-temporal';
import { ControlButton } from './DomainControls';
import type { TemporalFieldProps } from './TemporalField.types';
import { TemporalValueControl } from './TemporalValueControl';
/** Native consumers retain their existing pickers; this is a complete fallback. */
export function TemporalField({ label, mode, value, onChange, disabled, minimumDate, maximumDate, rowLabel }: TemporalFieldProps) {
  const [open, setOpen] = useState<'date' | 'time' | null>(null), date = new Date(mode === 'date' && browserCalendarDay(value) ? value + 'T12:00:00' : value || Date.now());
  const change = (selected: Date) => onChange(mode === 'date' ? `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}` : selected.toISOString());
  const display = mode === 'date' && browserCalendarDay(value) ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date) : value || 'Choose';
  return <View style={{ gap: 8 }}>{rowLabel ? <TemporalValueControl label={rowLabel} accessibilityLabel={label} value={display} disabled={disabled} onPress={() => setOpen('date')} /> : <ControlButton title={`${label}: ${value || 'Choose'}`} disabled={disabled} onPress={() => setOpen('date')} />}{open ? <><DateTimePicker mode={Platform.OS === 'ios' && mode === 'datetime' ? 'datetime' : open} value={Number.isFinite(date.getTime()) ? date : new Date()} disabled={disabled} minimumDate={minimumDate} maximumDate={maximumDate} onChange={(_event, selected) => { if (selected) change(selected); if (Platform.OS !== 'ios') setOpen(mode === 'datetime' && open === 'date' ? 'time' : null); }} />{Platform.OS === 'ios' ? <ControlButton title="Done" onPress={() => setOpen(null)} /> : null}</> : null}</View>;
}
