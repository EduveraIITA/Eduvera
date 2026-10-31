import { createElement, useState } from 'react';
import { Text, View } from 'react-native';
import { browserCalendarDay, browserLocalDateTime, browserLocalDateTimeIso } from '../lib/browser-temporal';
import { useTheme } from './theme';
import type { TemporalFieldProps } from './TemporalField.types';
export function TemporalField({ label, mode, value, onChange, disabled, minimumDate, maximumDate, rowLabel }: TemporalFieldProps) {
  const { colors, dark } = useTheme(), [invalid, setInvalid] = useState(false);
  const inputValue = mode === 'date' ? value : value ? browserLocalDateTime(value) : '';
  return <View style={{ gap: 6 }}><Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>{rowLabel ?? label}</Text>{createElement('input', {
    type: mode === 'date' ? 'date' : 'datetime-local', 'aria-label': label, value: inputValue, disabled,
    step: mode === 'date' ? undefined : '.001', min: minimumDate ? mode === 'date' ? browserLocalDateTime(minimumDate).slice(0, 10) : browserLocalDateTime(minimumDate) : undefined, max: maximumDate ? mode === 'date' ? browserLocalDateTime(maximumDate).slice(0, 10) : browserLocalDateTime(maximumDate) : undefined,
    onChange: (event: { target: { value: string } }) => {
      const selected = event.target.value, next = mode === 'date' ? browserCalendarDay(selected) && (!minimumDate || selected >= browserLocalDateTime(minimumDate).slice(0, 10)) && (!maximumDate || selected <= browserLocalDateTime(maximumDate).slice(0, 10)) ? selected : null : browserLocalDateTimeIso(selected, minimumDate, maximumDate);
      setInvalid(!next); if (next) onChange(next);
    },
    style: { width: '100%', boxSizing: 'border-box', minWidth: 0, minHeight: 44, fontSize: 16, padding: 10, border: `1px solid ${colors.border}`, borderRadius: 16, color: colors.ink, backgroundColor: colors.surface, colorScheme: dark ? 'dark' : 'light' },
  })}{invalid ? <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14, lineHeight: 20 }}>Choose a valid local date and time within the allowed range.</Text> : null}</View>;
}
