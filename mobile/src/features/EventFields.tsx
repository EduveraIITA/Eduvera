import { useState } from 'react';
import { Platform, Switch, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { TemporalField } from '../ui/TemporalField';
import { Button, Notice, Row, SearchField } from '../ui/components';
import { ChoiceMenu, ControlButton } from '../ui/DomainControls';
import { DomainPages, DomainText } from './ResourcesScreen';
import { useTheme } from '../ui/theme';
import type { EventWriter } from '../lib/use-event-command';
import { captureApiContext } from '../lib/api';

export const eventLabel = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
export const eventMoney = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value / 100);
export function EventToggle({ label, value, disabled, onChange }: { label: string; value: boolean; disabled?: boolean; onChange(value: boolean): void }) {
  const { colors } = useTheme();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}><Text style={{ color: colors.ink, flex: 1, fontSize: 16, lineHeight: 24 }}>{label}</Text><Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange} /></View>;
}
export function EventDateField({ label, value, disabled, dateOnly = false, now, onChange }: { label: string; value: string | null; disabled?: boolean; dateOnly?: boolean; now: string | number; onChange(value: string): void }) {
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  const date = value ? new Date(dateOnly ? `${value}T12:00:00` : value) : new Date(now);
  const selected = Number.isFinite(date.getTime()) ? date : new Date(now);
  if (Platform.OS === 'web') return <TemporalField label={label} mode={dateOnly ? 'date' : 'datetime'} value={value ?? ''} disabled={disabled} onChange={onChange} />;
  return <><ControlButton title={`${label}: ${value ? dateOnly ? value : selected.toLocaleString() : 'Choose'}`} disabled={disabled} onPress={() => setMode('date')} />{mode ? <><DateTimePicker value={selected} mode={mode} display={Platform.OS === 'ios' ? 'spinner' : 'default'} onValueChange={(_event, chosen) => { onChange(dateOnly ? `${chosen.getFullYear()}-${String(chosen.getMonth() + 1).padStart(2, '0')}-${String(chosen.getDate()).padStart(2, '0')}` : chosen.toISOString()); if (Platform.OS !== 'ios') setMode(!dateOnly && mode === 'date' ? 'time' : null); }} onDismiss={() => setMode(null)} />{Platform.OS === 'ios' ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{!dateOnly ? <ControlButton title={mode === 'date' ? 'Choose time' : 'Choose date'} onPress={() => setMode(mode === 'date' ? 'time' : 'date')} /> : null}<Button title="Use selected date" onPress={() => { onChange(dateOnly ? `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}` : selected.toISOString()); setMode(null); }} /></View> : null}</> : null}</>;
}
export function EventSelect({ label, value, options, disabled, onChange }: { label: string; value: string; options: readonly { id: string; label: string }[]; disabled?: boolean; onChange(value: string): void }) {
  return <><ChoiceMenu label={label} value={value} options={options.map(item => ({ value: item.id, label: item.label }))} disabled={disabled} onChange={onChange} />{value && !options.some(item => item.id === value) ? <DomainText>Saved selection retained outside the current catalogue.</DomainText> : null}</>;
}
export function EventMultiSelect({ label, selected, options, disabled, maximum, onChange }: { label: string; selected: string[]; options: readonly { id: string; label: string }[]; disabled?: boolean; maximum: number; onChange(value: string[]): void }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const shown = options.filter(item => item.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <><ControlButton title={`${label}: ${selected.length} selected`} disabled={disabled} onPress={() => setOpen(!open)} />{open ? <><SearchField label={`Find ${label.toLowerCase()}`} value={search} disabled={disabled} placeholder="Name or label" onChangeText={value => { setSearch(value); setPage(1); }} />{shown.slice((page - 1) * 10, page * 10).map(item => <EventToggle key={item.id} label={item.label} value={selected.includes(item.id)} disabled={disabled || !selected.includes(item.id) && selected.length >= maximum} onChange={checked => onChange(checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} />)}{selected.some(id => !options.some(item => item.id === id)) ? <Notice message="Some saved selections are outside this current catalogue. They remain retained; the service checks current eligibility when saving." /> : null}<EventChoicePages page={page} total={shown.length} onPage={setPage} /></> : null}</>;
}
function EventChoicePages({ page, total, onPage }: { page: number; total: number; onPage(page: number): void }) { return total > 10 || page > 1 ? <DomainPages page={page} hasMore={page * 10 < total} onChange={onPage} /> : null; }
export function EventPending({ writer, onNavigate, afterRecovery }: { writer: EventWriter; onNavigate(href: string): void; afterRecovery?(): void }) {
  const [error, setError] = useState('');
  async function recover() { setError(''); try { const context = captureApiContext(); const complete = await writer.recover(); context.assertCurrent(); if (complete) afterRecovery?.(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'The retained action could not be checked.'); } }
  return <>{writer.error || error ? <Notice tone="danger" message={error || writer.error} /> : null}{writer.resumeHref ? <Button title="Return to retained event action" kind="secondary" onPress={() => onNavigate(writer.resumeHref!)} /> : writer.action ? <><Row title="Earlier event action retained" detail={writer.action.phase === 'accepted' ? 'Saved. Refresh the exact record to finish.' : writer.action.replayPolicy === 'same_request' ? 'The original request is kept. Recovery retries only those same details.' : 'The outcome is unconfirmed. Inspect the owning record before repeating it.'} /><Button title={writer.action.phase === 'accepted' ? 'Refresh saved record' : writer.action.replayPolicy === 'same_request' ? 'Recover identical event action' : 'Inspect saved event record'} busy={writer.busy} onPress={() => { void recover(); }} /></> : null}</>;
}
