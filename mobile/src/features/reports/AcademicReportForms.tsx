import React, { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import type { AcademicReportWorkspace, GradingPolicy, GradingPolicyConfiguration, GradingSchemeDetail } from '../../../../packages/contracts/src/academic-reports';
import { gradingConfigurationError, initialReportComponent, initialReportReviewMode, reportSchemeDraftDirty, reportSubjectDraftDirty, subjectPlanError } from '../../lib/academic-report-policy';
import { Field, Notice, Row, Section } from '../../ui/components';
import { ChoiceMenu, ControlButton, Disclosure, Facts, SegmentedControl } from '../../ui/DomainControls';
import type { AcademicReportWriter } from './useAcademicReportCommand';

type FormProps = { root: string; href: string; writer: AcademicReportWriter; disabled?: boolean; onDirtyChange(dirty: boolean): void };
export function PolicyDetails({ configuration: c }: { configuration: GradingPolicyConfiguration }) {
  return <>
    <Facts items={[{ label: 'Format', value: c.result_format === 'gpa' ? `${c.grade_point_scale}-point GPA` : c.result_format === 'grade' ? 'Grades' : 'Percentage' }, { label: 'Weighting', value: c.aggregation === 'equal' ? 'Equal subject weight' : 'Credit weighted' }, { label: 'Precision', value: `${c.decimal_places} decimal places` }, { label: 'Absence', value: c.absence_treatment === 'zero' ? 'Counts as zero' : 'Keeps report incomplete' }, { label: 'Exemption', value: 'Excluded' }]} />
    {c.result_format === 'gpa' ? <Notice message={`${c.gpa_failure_treatment === 'withhold' ? 'SGPA is withheld while an included course is below pass.' : 'Failed courses retain their credits and mapped points.'} CGPA uses published courses in the same programme. The latest attempt, including an incomplete or failed retake, replaces an earlier attempt.`} /> : null}
    {c.bands.map(band => <Row key={band.code} title={`${band.code} · ${band.label}`} detail={`${band.minimum_percentage}–${band.maximum_percentage}%${c.result_format === 'gpa' ? ` · ${band.grade_points ?? 'Unknown'} points` : ''} · ${band.passed ? 'Pass' : 'Below pass'}`} variant="plain" separator />)}
  </>;
}
type Band = { code: string; label: string; min: string; max: string; points: string; passed: boolean };
const initialBands: Band[] = [
  { code: 'F', label: 'Below pass', min: '0', max: '39.99', points: '0', passed: false }, { code: 'D', label: 'Pass', min: '40', max: '49.99', points: '4', passed: true }, { code: 'C', label: 'Satisfactory', min: '50', max: '59.99', points: '5', passed: true }, { code: 'B', label: 'Good', min: '60', max: '69.99', points: '6', passed: true }, { code: 'B+', label: 'Very good', min: '70', max: '79.99', points: '8', passed: true }, { code: 'A', label: 'Excellent', min: '80', max: '89.99', points: '9', passed: true }, { code: 'A+', label: 'Outstanding', min: '90', max: '100', points: '10', passed: true },
];
export function ReportPolicyForm({ root, href, writer, source, disabled, onDirtyChange }: FormProps & { source?: GradingPolicy }) {
  const [name, setName] = useState(source?.name ?? ''), [code, setCode] = useState(source?.code ?? '');
  const [format, setFormat] = useState<GradingPolicyConfiguration['result_format']>(source?.configuration.result_format ?? 'percentage');
  const [aggregation, setAggregation] = useState<GradingPolicyConfiguration['aggregation']>(source?.configuration.aggregation ?? 'equal');
  const [scale, setScale] = useState(String(source?.configuration.grade_point_scale ?? 10)), [precision, setPrecision] = useState(String(source?.configuration.decimal_places ?? 2));
  const [absence, setAbsence] = useState<GradingPolicyConfiguration['absence_treatment']>(source?.configuration.absence_treatment ?? 'incomplete'), [failure, setFailure] = useState<GradingPolicyConfiguration['gpa_failure_treatment']>(source?.configuration.gpa_failure_treatment ?? 'include');
  const [bands, setBands] = useState<Band[]>(source ? source.configuration.bands.map(band => ({ code: band.code, label: band.label, min: String(band.minimum_percentage), max: String(band.maximum_percentage), points: String(band.grade_points ?? 0), passed: band.passed })) : initialBands);
  const [step, setStep] = useState('setup'), [error, setError] = useState(''), [dirty, setDirty] = useState(false);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const locked = disabled || writer.locked;
  const configuration: GradingPolicyConfiguration = { schema_version: 1, result_format: format, aggregation, grade_point_scale: format === 'gpa' ? Number(scale) : null, decimal_places: Number(precision), absence_treatment: absence, exemption_treatment: 'exclude', gpa_failure_treatment: failure, bands: bands.map(band => ({ code: band.code.trim().toUpperCase(), label: band.label.trim(), minimum_percentage: Number(band.min), maximum_percentage: Number(band.max), grade_points: format === 'gpa' ? Number(band.points) : null, passed: band.passed })) };
  const change = (work: () => void) => { setDirty(true); setError(''); work(); };
  const updateBand = (index: number, patch: Partial<Band>) => change(() => setBands(current => current.map((band, item) => index === item ? { ...band, ...patch } : band)));
  const valid = () => {
    const problem = name.trim().length < 2 || code.trim().length < 2 ? 'Provide a policy name and code with at least two characters.' : bands.some(band => !band.min.trim() || !band.max.trim() || format === 'gpa' && !band.points.trim()) ? 'Complete every grade range and its required points.' : gradingConfigurationError(configuration);
    setError(problem ?? ''); return !problem;
  };
  return <>
    <Notice message={source ? `Create a new version of ${source.code}, starting from version ${source.version}. Existing results retain their frozen policy.` : 'Review the editable starting bands and calculation. Create a draft, then activate it separately after review.'} />
    <SegmentedControl label="Policy setup" value={step} options={[{ value: 'setup', label: 'Setup' }, { value: 'bands', label: 'Bands' }, { value: 'review', label: 'Review' }]} disabled={locked} onChange={value => { if (value !== 'review' || valid()) setStep(value); }} />
    <View style={{ display: step === 'setup' ? 'flex' : 'none', gap: 16 }}>
      <Field label="Policy name" value={name} maxLength={120} editable={!locked} onChangeText={value => change(() => setName(value))} />
      <Field label="Policy code" value={code} maxLength={32} autoCapitalize="characters" editable={!locked && !source} onChangeText={value => change(() => setCode(value.toUpperCase()))} />
      <ChoiceMenu label="Result format" value={format} disabled={locked} options={[{ value: 'percentage', label: 'Percentage' }, { value: 'grade', label: 'Grade' }, { value: 'gpa', label: 'Grade points / GPA' }]} onChange={value => change(() => { setFormat(value as typeof format); if (value === 'gpa') setAggregation('credit_weighted'); })} />
      {format === 'gpa' ? <Field label="Grade-point scale" value={scale} keyboardType="decimal-pad" editable={!locked} onChangeText={value => change(() => setScale(value))} /> : null}
      <ChoiceMenu label="Decimal places" value={precision} disabled={locked} options={[0, 1, 2, 3, 4].map(value => ({ value: String(value), label: String(value) }))} onChange={value => change(() => setPrecision(value))} />
      <ChoiceMenu label="Subject weighting" value={aggregation} disabled={locked} options={[...(format !== 'gpa' ? [{ value: 'equal', label: 'Equal subject weight' }] : []), { value: 'credit_weighted', label: 'Credit weighted' }]} onChange={value => change(() => setAggregation(value as typeof aggregation))} />
      <ChoiceMenu label="Absent result" value={absence} disabled={locked} options={[{ value: 'incomplete', label: 'Keep report incomplete' }, { value: 'zero', label: 'Count as zero' }]} onChange={value => change(() => setAbsence(value as typeof absence))} />
      {format === 'gpa' ? <ChoiceMenu label="Failed courses" value={failure} disabled={locked} options={[{ value: 'include', label: 'Include credits and mapped points' }, { value: 'withhold', label: 'Withhold GPA until all pass' }]} onChange={value => change(() => setFailure(value as typeof failure))} /> : null}
      <ControlButton title="Review grade bands" disabled={locked} onPress={() => setStep('bands')} />
    </View>
    <View style={{ display: step === 'bands' ? 'flex' : 'none', gap: 16 }}>
      {bands.map((band, index) => <Disclosure key={index} title={`${band.code || `Grade ${index + 1}`} · ${band.min || '…'}–${band.max || '…'}%`} defaultOpen={index === 0}>
        <Field label={`Grade code ${index + 1}`} value={band.code} maxLength={24} editable={!locked} onChangeText={value => updateBand(index, { code: value })} />
        <Field label={`Grade meaning ${index + 1}`} value={band.label} maxLength={80} editable={!locked} onChangeText={value => updateBand(index, { label: value })} />
        <Field label={`Minimum percentage ${index + 1}`} value={band.min} keyboardType="decimal-pad" editable={!locked} onChangeText={value => updateBand(index, { min: value })} />
        <Field label={`Maximum percentage ${index + 1}`} value={band.max} keyboardType="decimal-pad" editable={!locked} onChangeText={value => updateBand(index, { max: value })} />
        {format === 'gpa' ? <Field label={`Grade points ${index + 1}`} value={band.points} keyboardType="decimal-pad" editable={!locked} onChangeText={value => updateBand(index, { points: value })} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Row title="Passing grade" variant="plain" /><Switch accessibilityLabel={`Passing grade ${index + 1}`} value={band.passed} disabled={locked} onValueChange={value => updateBand(index, { passed: value })} /></View>
        <ControlButton title={`Remove ${band.code || 'grade'}`} kind="secondary" disabled={locked || bands.length === 1} onPress={() => change(() => setBands(current => current.filter((_, item) => item !== index)))} />
      </Disclosure>)}
      <ControlButton title="Add grade" kind="secondary" disabled={locked || bands.length >= 30} onPress={() => change(() => setBands(current => [...current, { code: '', label: '', min: '', max: '', points: '', passed: true }]))} />
      <ControlButton title="Review policy" disabled={locked} onPress={() => { if (valid()) setStep('review'); }} />
    </View>
    {step === 'review' ? <Section title={`${name} · ${code}`}><PolicyDetails configuration={configuration} /><ControlButton title="Create draft policy" busy={writer.busy} disabled={locked} onPress={() => { if (valid()) void writer.run({ ownerHref: href, endpoint: `${root}/policies/`, body: { name: name.trim(), code: code.trim().toUpperCase(), configuration } }); }} /></Section> : null}
    {error ? <Notice tone="warning" message={error} /> : null}
  </>;
}

export function ReportSchemeForm({ root, href, writer, data, disabled, onDirtyChange }: FormProps & { data: Extract<AcademicReportWorkspace, { mode: 'admin' }> }) {
  const policies = (data.policies ?? []).filter(policy => policy.status === 'active');
  const [termId, setTermId] = useState(''), [classId, setClassId] = useState(''), [policyId, setPolicyId] = useState(''), [name, setName] = useState(''), [code, setCode] = useState('');
  const [reviewMode, setReviewMode] = useState<string>(initialReportReviewMode), [programme, setProgramme] = useState(''), [termIndex, setTermIndex] = useState(''), [review, setReview] = useState(false), [error, setError] = useState('');
  const term = data.references.terms.find(item => item.id === termId), policy = policies.find(item => item.id === policyId), classes = data.references.classes.filter(item => item.academic_year === term?.academic_year), selectedClass = classes.find(item => item.id === classId);
  const dirty = reportSchemeDraftDirty({ termId, classId, policyId, name, code, programme, termIndex, reviewMode });
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const locked = disabled || writer.locked;
  const valid = () => { const problem = !term || !selectedClass || !policy ? 'Choose the exact term, class and active grading policy.' : name.trim().length < 2 || code.trim().length < 2 ? 'Provide a scheme name and code with at least two characters.' : policy.configuration.result_format === 'gpa' && (programme.trim().length < 2 || !Number.isSafeInteger(Number(termIndex)) || Number(termIndex) < 1 || Number(termIndex) > 100) ? 'GPA needs a stable programme key and a positive term number.' : ''; setError(problem); return !problem; };
  return <>
    {!policies.length ? <Notice tone="warning" message="Create and activate a grading policy before creating a scheme." /> : null}
    <View style={{ display: review ? 'none' : 'flex', gap: 16 }}>
      <ChoiceMenu label="Term" value={termId} disabled={locked} options={[{ value: '', label: 'Choose term' }, ...data.references.terms.map(item => ({ value: item.id, label: `${item.name} · ${item.academic_year}` }))]} onChange={value => { setTermId(value); setClassId(''); }} />
      <ChoiceMenu label="Class" value={classId} disabled={locked || !term} options={[{ value: '', label: 'Choose class' }, ...classes.map(item => ({ value: item.id, label: item.name }))]} onChange={setClassId} />
      <Field label="Scheme name" value={name} maxLength={120} editable={!locked} onChangeText={setName} /><Field label="Scheme code" value={code} maxLength={32} autoCapitalize="characters" editable={!locked} onChangeText={value => setCode(value.toUpperCase())} />
      <ChoiceMenu label="Grading policy" value={policyId} disabled={locked} options={[{ value: '', label: 'Choose active policy' }, ...policies.map(item => ({ value: item.id, label: `${item.name} · v${item.version}` }))]} onChange={setPolicyId} />
      <ChoiceMenu label="Approval" value={reviewMode} disabled={locked} options={[{ value: 'independent', label: 'Independent reviewer' }, { value: 'owner_review', label: 'Owner review' }]} onChange={setReviewMode} />
      {policy?.configuration.result_format === 'gpa' ? <><Field label="Programme key" value={programme} maxLength={80} autoCapitalize="characters" editable={!locked} onChangeText={setProgramme} /><Field label="Term number" value={termIndex} keyboardType="number-pad" editable={!locked} onChangeText={setTermIndex} /></> : null}
      <ControlButton title="Review scheme" disabled={locked || !policies.length} onPress={() => { if (valid()) setReview(true); }} />
    </View>
    {review && policy ? <Section title="Review scheme"><Facts items={[{ label: 'Scheme', value: `${name} · ${code}` }, { label: 'Class', value: selectedClass?.name ?? 'Unavailable' }, { label: 'Term', value: `${term?.name} · ${term?.academic_year}` }, { label: 'Policy', value: `${policy.name} · v${policy.version}` }, { label: 'Approval', value: reviewMode === 'independent' ? 'Independent reviewer' : 'Owner review' }]} /><PolicyDetails configuration={policy.configuration} /><ControlButton title="Edit details" kind="secondary" disabled={locked} onPress={() => setReview(false)} /><ControlButton title="Create draft scheme" disabled={locked} busy={writer.busy} onPress={() => { if (valid() && policy && term && selectedClass) void writer.run({ ownerHref: href, endpoint: `${root}/schemes/`, body: { term_id: term.id, class_section_id: selectedClass.id, name: name.trim(), code: code.trim().toUpperCase(), grading_policy_id: policy.id, review_mode: reviewMode, absence_treatment: policy.configuration.absence_treatment, programme_key: policy.configuration.result_format === 'gpa' ? programme.trim().toUpperCase() : null, term_index: policy.configuration.result_format === 'gpa' ? Number(termIndex) : null } }); }} /></Section> : null}
    {error ? <Notice tone="warning" message={error} /> : null}
  </>;
}

export function ReportSubjectForm({ root, href, writer, data, detail, disabled, onDirtyChange }: FormProps & { data: Extract<AcademicReportWorkspace, { mode: 'admin' }>; detail: GradingSchemeDetail }) {
  const [revision] = useState(detail.scheme.revision), [subjectId, setSubjectId] = useState(''), [credits, setCredits] = useState(''), [courseCode, setCourseCode] = useState(''), [pass, setPass] = useState('');
  const [components, setComponents] = useState<{ code: string; name: string; weight: string; assessment_ids: string[] }[]>([{ ...initialReportComponent, assessment_ids: [] }]), [error, setError] = useState('');
  const eligible = data.references.assessments.filter(item => item.subject_id === subjectId && item.class_section_id === detail.scheme.class_section_id && item.term_id === detail.scheme.term_id);
  const needsCredits = detail.scheme.result_policy?.configuration.result_format === 'gpa' || detail.scheme.result_policy?.configuration.aggregation === 'credit_weighted';
  const dirty = reportSubjectDraftDirty({ subjectId, credits, courseCode, pass, components });
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const stale = revision !== detail.scheme.revision, locked = disabled || writer.locked || stale || detail.scheme.status !== 'draft';
  const update = (index: number, patch: Partial<typeof components[number]>) => setComponents(current => current.map((component, item) => index === item ? { ...component, ...patch } : component));
  function submit() {
    const input = { subjectId, credits: needsCredits ? Number(credits) : null, courseCode: needsCredits ? courseCode.trim().toUpperCase() : null, components: components.map(component => ({ code: component.code.trim().toUpperCase(), name: component.name.trim(), weight_percentage: Number(component.weight), assessment_ids: component.assessment_ids })) };
    const problem = subjectPlanError(input, detail, data) ?? (pass && (!Number.isFinite(Number(pass)) || Number(pass) < 0 || Number(pass) > 100) ? 'Pass percentage must be between zero and one hundred.' : null); setError(problem ?? '');
    if (!problem && !locked) void writer.run({ ownerHref: href, endpoint: `${root}/schemes/${encodeURIComponent(detail.scheme.id)}/subjects/`, method: 'PUT', body: { subject_id: input.subjectId, expected_revision: revision, credits: input.credits, course_code: input.courseCode, pass_percentage: detail.scheme.result_policy ? null : pass ? Number(pass) : null, components: input.components } });
  }
  return <Section title="Subject grading plan">
    {stale ? <Notice tone="warning" message="This scheme changed. Your subject plan has not been applied. Review the saved scheme before starting again." /> : null}
    <ChoiceMenu label="Subject" value={subjectId} disabled={locked} options={[{ value: '', label: 'Choose subject' }, ...data.references.subjects.map(item => ({ value: item.id, label: item.name }))]} onChange={value => { setSubjectId(value); setComponents(current => current.map(component => ({ ...component, assessment_ids: [] }))); }} />
    {!detail.scheme.result_policy ? <Field label="Pass percentage (optional)" value={pass} keyboardType="decimal-pad" editable={!locked} onChangeText={setPass} /> : <Notice message="Pass decisions follow the frozen grading policy." />}
    {needsCredits ? <><Field label="Stable course code" value={courseCode} maxLength={80} editable={!locked} onChangeText={setCourseCode} /><Field label="Course credits" value={credits} keyboardType="decimal-pad" editable={!locked} onChangeText={setCredits} /></> : null}
    {components.map((component, index) => <Section key={index} title={`Component ${index + 1}`}>
      <Field label={`Component name ${index + 1}`} value={component.name} maxLength={100} editable={!locked} onChangeText={value => update(index, { name: value })} /><Field label={`Component code ${index + 1}`} value={component.code} maxLength={32} editable={!locked} onChangeText={value => update(index, { code: value })} /><Field label={`Weight percentage ${index + 1}`} value={component.weight} keyboardType="decimal-pad" editable={!locked} onChangeText={value => update(index, { weight: value })} />
      <ChoiceMenu label={`Add published assessment to component ${index + 1}`} value="" disabled={locked || !eligible.length} options={[{ value: '', label: 'Choose assessment' }, ...eligible.filter(item => !components.some(other => other.assessment_ids.includes(item.id))).map(item => ({ value: item.id, label: `${item.title} · ${item.maximum_marks} marks · release ${item.publication_sequence}` }))]} onChange={value => { if (value && eligible.some(item => item.id === value)) update(index, { assessment_ids: [...component.assessment_ids, value] }); }} />
      {component.assessment_ids.map(id => <View key={id}><Row title={eligible.find(item => item.id === id)?.title ?? 'Source unavailable'} detail="Published assessment" /><ControlButton title="Remove" kind="secondary" disabled={locked} onPress={() => update(index, { assessment_ids: component.assessment_ids.filter(value => value !== id) })} /></View>)}
      {components.length > 1 ? <ControlButton title={`Remove component ${index + 1}`} kind="secondary" disabled={locked} onPress={() => setComponents(current => current.filter((_, item) => item !== index))} /> : null}
    </Section>)}
    {!eligible.length && subjectId ? <Notice message="No published assessments are available for this exact subject, class and term." /> : null}
    <ControlButton title="Add component" kind="secondary" disabled={locked || components.length >= 20} onPress={() => setComponents(current => [...current, { code: '', name: '', weight: '', assessment_ids: [] }])} />
    {error ? <Notice tone="warning" message={error} /> : null}<ControlButton title="Save subject plan" disabled={locked} busy={writer.busy} onPress={submit} />
  </Section>;
}
