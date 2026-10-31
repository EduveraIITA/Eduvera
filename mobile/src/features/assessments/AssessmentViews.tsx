import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AssessmentResult, AssessmentSummary } from '../../../../packages/contracts/src/assessments';
import { previewConfiguredGrade } from '../../../../packages/contracts/src/result-presentation';
import { Field } from '../../ui/components';
import { ChoiceMenu, ControlButton, Disclosure } from '../../ui/DomainControls';
import { Icon } from '../../ui/Icon';
import { useTheme } from '../../ui/theme';
import { themeRadii } from '../../ui/theme-tokens';

const nice = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
type MarkDraft = { outcome: string; marks: string; grade: string; feedback: string; reason: string };

export function AssessmentStatus({ value }: { value: string }) {
  const { colors } = useTheme();
  const color = ['cancelled', 'absent', 'withheld'].includes(value) ? colors.danger
    : value === 'submitted' ? colors.warning
      : ['published', 'moderated', 'scored'].includes(value) ? colors.positive : colors.muted;
  return <Text style={[styles.status, { color }]}>{nice(value)}</Text>;
}

export function AssessmentPages({ page, pages, total, pageSize, onPage }: { page: number; pages: number; total: number; pageSize: number; onPage: (value: number) => void }) {
  const { colors } = useTheme();
  return pages > 1 ? <View style={styles.pagination}>
    <ControlButton title="Previous" kind="secondary" disabled={page <= 1} onPress={() => onPage(page - 1)} />
    <Text accessibilityLiveRegion="polite" style={[styles.caption, styles.pageCount, { color: colors.muted }]}>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</Text>
    <ControlButton title="Next" kind="secondary" disabled={page >= pages} onPress={() => onPage(page + 1)} />
  </View> : null;
}

/** The parent retains every draft and owns the single guarded save command. */
export function AssessmentResultRow({ result, assessment, draft, editable, disabled, onChange }: {
  result: AssessmentResult; assessment: AssessmentSummary; draft: MarkDraft; editable: boolean; disabled: boolean; onChange: (values: Partial<MarkDraft>) => void;
}) {
  const { colors } = useTheme();
  const policy = assessment.result_policy, preview = policy && draft.outcome === 'scored' ? previewConfiguredGrade(draft.marks, assessment.maximum_marks, policy.configuration) : null;
  const previewLabel = !preview ? 'Enter marks to preview' : policy?.configuration.result_format === 'gpa'
    ? `${preview.grade_points?.toFixed(policy.configuration.decimal_places) ?? 'Not available'} / ${policy.configuration.grade_point_scale} · ${preview.grade}`
    : policy?.configuration.result_format === 'grade' ? preview.grade : `${preview.percentage.toFixed(policy?.configuration.decimal_places ?? 2)}% · ${preview.grade}`;
  return <View style={[styles.learner, { backgroundColor: colors.row }]}>
    <View style={styles.learnerHeader}>
      {result.roll_number != null ? <Text style={[styles.roll, { backgroundColor: colors.surfaceSoft, color: colors.muted }]}>{result.roll_number}</Text> : null}
      <View style={styles.identity}><Text style={[styles.name, { color: colors.ink }]}>{result.first_name} {result.last_name}</Text>{result.admission_number ? <Text style={[styles.caption, { color: colors.muted }]}>{result.admission_number}</Text> : null}</View>
      <AssessmentStatus value={draft.outcome === 'unrecorded' ? 'not_recorded' : draft.outcome} />
    </View>
    {editable ? <>
      <ChoiceMenu label={`Outcome for ${result.first_name} ${result.last_name}`} value={draft.outcome} options={['unrecorded', 'scored', 'absent', 'exempt', 'withheld', 'not_evaluated'].map(value => ({ value, label: value === 'unrecorded' ? 'Not recorded' : nice(value) }))} disabled={disabled} onChange={outcome => { if (outcome !== 'unrecorded') onChange({ outcome, ...(outcome !== 'scored' ? { marks: '' } : {}) }); }} />
      {['scored', 'unrecorded'].includes(draft.outcome) ? <View style={styles.markRow}>
        <View style={styles.markField}><Field label={`Marks out of ${assessment.maximum_marks}`} accessibilityLabel={`Marks for ${result.first_name} ${result.last_name}, out of ${assessment.maximum_marks}`} value={draft.marks} onChangeText={marks => onChange({ marks, ...(marks.trim() ? { outcome: 'scored' } : {}) })} keyboardType="decimal-pad" editable={!disabled} /></View>
        {!policy ? <View style={styles.markField}><Field label="Grade" value={draft.grade} maxLength={24} onChangeText={grade => onChange({ grade })} editable={!disabled} /></View> : null}
      </View> : null}
      {policy && draft.outcome === 'scored' ? <View style={styles.preview}><Text style={[styles.name, { color: colors.ink }]}>{previewLabel}</Text><Text style={[styles.caption, { color: colors.muted }]}>Policy preview · confirmed on save</Text></View> : null}
      <Disclosure title="Feedback" defaultOpen={Boolean(draft.feedback)}><Field label="Feedback" value={draft.feedback} onChangeText={feedback => onChange({ feedback })} multiline maxLength={1000} editable={!disabled} /></Disclosure>
      {result.outcome !== 'unrecorded' ? <Field label="Reason for correction" value={draft.reason} onChangeText={reason => onChange({ reason })} maxLength={500} editable={!disabled} /> : null}
    </> : <View style={styles.preview}><Text style={[styles.value, { color: colors.ink }]}>{result.outcome === 'scored' ? `${result.marks ?? 'Not recorded'} / ${assessment.maximum_marks}${result.grade ? ` · ${result.grade}` : ''}` : nice(result.outcome)}</Text>{result.feedback ? <Text style={[styles.body, { color: colors.muted }]}>{result.feedback}</Text> : null}</View>}
    {result.evidence_count ? <Text style={[styles.caption, { color: colors.muted }]}>{result.evidence_count} evidence {result.evidence_count === 1 ? 'file' : 'files'} retained</Text> : null}
  </View>;
}

export function PublishedResultRow({ title, type, detail, published, value, secondary, onPress }: { title: string; type: string; detail: string; published: string; value: string; secondary?: string; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.resultRecord, { backgroundColor: colors.row, borderColor: colors.border, opacity: pressed ? .7 : 1 }]}>
    <View style={styles.recordTop}><View style={styles.identity}><Text style={[styles.caption, { color: colors.muted }]}>{type}</Text><Text style={[styles.name, { color: colors.ink }]}>{title}</Text></View><Icon name="chevron" size={18} muted /></View>
    <Text style={[styles.caption, { color: colors.muted }]}>{detail}</Text><Text style={[styles.caption, { color: colors.muted }]}>{published}</Text>
    <View style={styles.resultValue}><Text style={[styles.value, { color: colors.ink }]}>{value}</Text>{secondary ? <Text style={[styles.caption, { color: colors.muted }]}>{secondary}</Text> : null}</View>
  </Pressable>;
}

export function PublishedResultSummary({ label, value, secondary }: { label: string; value: string; secondary?: string }) {
  const { colors } = useTheme();
  return <View style={[styles.resultSummary, { backgroundColor: colors.row }]}><Text style={[styles.caption, { color: colors.muted }]}>{label}</Text><Text style={[styles.summaryValue, { color: colors.ink }]}>{value}</Text>{secondary ? <Text style={[styles.body, { color: colors.muted }]}>{secondary}</Text> : null}</View>;
}

const styles = StyleSheet.create({
  pagination: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 12 },
  pageCount: { flexShrink: 1, textAlign: 'center' }, caption: { fontSize: 14, lineHeight: 21 }, body: { fontSize: 16, lineHeight: 24 },
  learner: { padding: 16, borderRadius: themeRadii.radiusRow, gap: 12 }, learnerHeader: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' },
  identity: { flex: 1, minWidth: 120, gap: 4 }, name: { fontSize: 17, lineHeight: 24, fontWeight: '600' }, roll: { minWidth: 32, minHeight: 32, padding: 8, borderRadius: 12, textAlign: 'center', fontSize: 14 }, status: { fontSize: 14, lineHeight: 21, fontWeight: '600', flexShrink: 1 },
  markRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, markField: { flexGrow: 1, flexBasis: 120, minWidth: 0 }, preview: { gap: 4 },
  resultRecord: { padding: 16, borderRadius: themeRadii.radiusRow, borderWidth: StyleSheet.hairlineWidth, gap: 6 }, recordTop: { flexDirection: 'row', alignItems: 'center', gap: 12 }, resultValue: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 12, marginTop: 4 }, value: { fontSize: 20, lineHeight: 27, fontWeight: '600', fontVariant: ['tabular-nums'] },
  resultSummary: { padding: 20, borderRadius: themeRadii.radiusCard, gap: 8 }, summaryValue: { fontSize: 32, lineHeight: 39, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
