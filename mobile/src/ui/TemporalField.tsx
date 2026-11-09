import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { browserCalendarDay, browserLocalDateTime, browserLocalDateTimeIso, formatCampusDateTime } from '../lib/browser-temporal';
import { ControlButton } from './DomainControls';
import type { TemporalFieldProps } from './TemporalField.types';
import { TemporalValueControl } from './TemporalValueControl';
import { useTheme } from './theme';

export function TemporalField(props: TemporalFieldProps) {
  return props.mode === 'datetime' && props.timeZone
    ? <CampusDateTimeField {...props} timeZone={props.timeZone} />
    : <DeviceTemporalField {...props} />;
}

function DeviceTemporalField({ label, mode, value, onChange, disabled, minimumDate, maximumDate, rowLabel }: TemporalFieldProps) {
  const [open, setOpen] = useState<'date' | 'time' | null>(null), date = new Date(mode === 'date' && browserCalendarDay(value) ? value + 'T12:00:00' : value || Date.now());
  const change = (selected: Date) => onChange(mode === 'date' ? `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}` : selected.toISOString());
  const display = mode === 'date' && browserCalendarDay(value) ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date) : value || 'Choose';
  return <View style={{ gap: 8 }}>{rowLabel ? <TemporalValueControl label={rowLabel} accessibilityLabel={label} value={display} disabled={disabled} onPress={() => setOpen('date')} /> : <ControlButton title={`${label}: ${value || 'Choose'}`} disabled={disabled} onPress={() => setOpen('date')} />}{open ? <><DateTimePicker mode={Platform.OS === 'ios' && mode === 'datetime' ? 'datetime' : open} value={Number.isFinite(date.getTime()) ? date : new Date()} disabled={disabled} minimumDate={minimumDate} maximumDate={maximumDate} onChange={(_event, selected) => { if (selected) change(selected); if (Platform.OS !== 'ios') setOpen(mode === 'datetime' && open === 'date' ? 'time' : null); }} />{Platform.OS === 'ios' ? <ControlButton title="Done" onPress={() => setOpen(null)} /> : null}</> : null}</View>;
}

function CampusDateTimeField({ label, value, onChange, disabled, minimumDate, maximumDate, rowLabel, timeZone }: TemporalFieldProps & { timeZone: string }) {
  const { colors } = useTheme();
  const [stage, setStage] = useState<'date' | 'time' | null>(null);
  const [calendarDate, setCalendarDate] = useState<Date>(() => new Date());
  const [clockTime, setClockTime] = useState('12:00:00');
  const [invalid, setInvalid] = useState(false);
  const inline = Platform.OS === 'ios';
  const display = value ? formatCampusDateTime(value, timeZone) : 'Choose';

  function open() {
    if (!invalid || value) {
      const saved = new Date(value || Date.now());
      const current = Number.isFinite(saved.getTime()) ? saved : new Date();
      setCalendarDate(current);
      setClockTime(browserLocalDateTime(current, timeZone).slice(11) || '12:00:00');
    }
    setStage('date');
  }
  function commit(time: string) {
    const day = browserLocalDateTime(calendarDate, timeZone).slice(0, 10);
    const instant = browserLocalDateTimeIso(`${day}T${time}`, minimumDate, maximumDate, timeZone);
    setInvalid(!instant);
    onChange(instant ?? '');
    if (instant || !inline) setStage(null);
  }

  return <View style={{ gap: 8 }}>
    {rowLabel ? <TemporalValueControl label={rowLabel} accessibilityLabel={label} value={display} disabled={disabled} onPress={open} /> : <ControlButton title={`${label}: ${display}`} disabled={disabled} onPress={open} />}
    {stage === 'date' ? <DateTimePicker key="campus-date" accessibilityLabel="Campus date" mode="date" timeZoneName={timeZone} value={calendarDate} disabled={disabled} minimumDate={inline ? minimumDate : undefined} maximumDate={inline ? maximumDate : undefined} onDismiss={() => setStage(null)} onValueChange={(_event, selected) => { setCalendarDate(selected); if (!inline) setStage('time'); }} /> : null}
    {/* The clock carrier is UTC so the native picker cannot normalize an impossible campus time before validation. */}
    {stage === 'time' ? <DateTimePicker key="campus-time" accessibilityLabel="Campus time" mode="time" timeZoneName="UTC" value={new Date(`2000-01-01T${clockTime}Z`)} disabled={disabled} onDismiss={() => setStage(null)} onValueChange={(_event, selected) => { const time = selected.toISOString().slice(11, 23); setClockTime(time); if (!inline) commit(time); }} /> : null}
    {inline && stage === 'date' ? <ControlButton title="Choose time" disabled={disabled} onPress={() => setStage('time')} /> : null}
    {inline && stage === 'time' ? <ControlButton title="Done" disabled={disabled} onPress={() => commit(clockTime)} /> : null}
    {invalid && !value ? <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14, lineHeight: 20 }}>Choose a time within the allowed range that occurs once in the campus time zone.</Text> : null}
  </View>;
}
