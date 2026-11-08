import React, { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import type { AcademicReportWorkspace, GradingPolicy, GradingPolicyConfiguration, GradingSchemeDetail } from '../../../../packages/contracts/src/academic-reports';
import { gradingConfigurationError, initialReportComponent, initialReportReviewMode, reportSchemeDraftDirty, reportSubjectDraftDirty, subjectPlanError } from '../../lib/academic-report-policy';
import { eligibleReportAssessments, reportContextKind, reportPlanOffering, reportTermOfferings } from '../../lib/academic-report-context';
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
  const policies = (data.policies ?? []).filter(policy => policy.status === 'active'), query = new URLSearchParams(href.split('?')[1] ?? '');
  const hint = query.getAll('offering_id').length === 1 ? data.references.offerings?.find(item => item.id === query.get('offering_id') && item.academic_context && data.references.terms.some(term => term.id === item.academic_context!.term_id)) : undefined;
  const [contextKind, setContextKind] = useState<'class_term' | 'learning_offering'>(query.has('offering_id') ? 'learning_offering' : 'class_term');
  const [offeringIds, setOfferingIds] = useState<string[]>(hint ? [hint.id] : []), [termId, setTermId] = useState(hint?.academic_context?.term_id ?? '');
  const [classId, setClassId] = useState(''), [policyId, setPolicyId] = useState(''), [name, setName] = useState(''), [code, setCode] = useState('');
  const [reviewMode, setReviewMode] = useState<string>(initialReportReviewMode), [programme, setProgramme] = useState(hint?.academic_context?.programme_key ?? ''), [termIndex, setTermIndex] = useState(''), [reviewed, setReviewed] = useState<string | null>(null), [error, setError] = useState('');
  const term = data.references.terms.find(item => item.id === termId), policy = policies.find(item => item.id === policyId), classes = data.references.classes.filter(item => item.academic_year === term?.academic_year), selectedClass = classes.find(item => item.id === classId);
  const offerings = reportTermOfferings(data.references, termId), selected = offeringIds.map(id => offerings.find(item => item.id === id));
  const dirty = reportSchemeDraftDirty({ contextKind, offeringIds, termId, classId, policyId, name, code, programme, termIndex, reviewMode });
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const locked = disabled || writer.locked, course = contextKind === 'learning_offering';
  const signature = JSON.stringify({ contextKind, termId, classId: course ? null : classId, offerings: course ? selected : [], policy, name, code, programme, termIndex, reviewMode });
  const change = (work: () => void) => { setReviewed(null); setError(''); work(); };
  const valid = () => {
    const contextValid = course ? offeringIds.length > 0 && offeringIds.length <= 100 && new Set(offeringIds).size === offeringIds.length && selected.every(Boolean) : !!selectedClass;
    const problem = !term || !contextValid || !policy ? 'Choose the exact term, report audience and active grading policy.' : name.trim().length < 2 || code.trim().length < 2 ? 'Provide a scheme name and code with at least two characters.' : policy.configuration.result_format === 'gpa' && (programme.trim().length < 2 || !Number.isSafeInteger(Number(termIndex)) || Number(termIndex) < 1 || Number(termIndex) > 100) ? 'GPA needs a stable programme key and a positive term number.' : policy.configuration.result_format === 'gpa' && selected.some(item => item?.academic_context?.programme_key && item.academic_context.programme_key !== programme.trim().toUpperCase()) ? 'The programme key must match every selected course that has a programme binding.' : '';
    setError(problem); return !problem;
  };
  function save() {
    if (locked || reviewed !== signature || !valid() || !term || !policy) return;
    void writer.run({ ownerHref: href, endpoint: `${root}/schemes/`, body: { context_kind: contextKind, term_id: term.id, class_section_id: course ? null : classId, ...(course ? { offering_ids: [...offeringIds].sort() } : {}), name: name.trim(), code: code.trim().toUpperCase(), grading_policy_id: policy.id, review_mode: reviewMode, absence_treatment: policy.configuration.absence_treatment, programme_key: policy.configuration.result_format === 'gpa' ? programme.trim().toUpperCase() : null, term_index: policy.configuration.result_format === 'gpa' ? Number(termIndex) : null } });
  }
  return <>
    {!policies.length ? <Notice tone="warning" message="Create and activate a grading policy before creating a scheme." /> : null}
    {query.has('offering_id') && !hint ? <Notice tone="warning" message="The requested course is not available in these report references. Choose the current term and courses explicitly." /> : null}
    {!reviewed ? <View style={{ gap: 16 }}>
      <SegmentedControl label="Report audience" value={contextKind} disabled={locked} options={[{ value: 'class_term', label: 'Class' }, { value: 'learning_offering', label: 'Course offerings' }]} onChange={value => change(() => { setContextKind(value as typeof contextKind); setClassId(''); setOfferingIds([]); })} />
      <ChoiceMenu label="Term" value={termId} disabled={locked} options={[{ value: '', label: 'Choose term' }, ...data.references.terms.map(item => ({ value: item.id, label: `${item.name} · ${item.academic_year}` }))]} onChange={value => change(() => { setTermId(value); setClassId(''); setOfferingIds([]); })} />
      {course ? <Section title="Courses in this report"><Notice message="Choose the courses for one term. Published enrollment determines each learner’s courses; other electives are not added to their report." />
        <ChoiceMenu label="Add course offering" value="" disabled={locked || !term || offeringIds.length >= 100} options={[{ value: '', label: 'Choose a course' }, ...offerings.filter(item => !offeringIds.includes(item.id)).map(item => ({ value: item.id, label: `${item.academic_context!.course_code} · ${item.name} · ${item.academic_context!.credits} credits` }))]} onChange={value => change(() => { const item = offerings.find(offering => offering.id === value); if (item && !offeringIds.includes(value)) { setOfferingIds(current => [...current, value]); if (!programme && item.academic_context?.programme_key) setProgramme(item.academic_context.programme_key); } })} />
        {selected.map((item, index) => <View key={offeringIds[index]}><Row title={item?.name ?? 'Course no longer available'} detail={item?.academic_context ? `${item.academic_context.course_code} · ${item.academic_context.subject_name} · ${item.academic_context.credits} credits` : 'Refresh and choose this course again.'} /><ControlButton title={`Remove ${item?.name ?? 'course'}`} kind="secondary" disabled={locked} onPress={() => change(() => setOfferingIds(current => current.filter(id => id !== offeringIds[index])))} /></View>)}
        {term && !offerings.length ? <Notice message="No course offerings have academic details for this term. Add optional term, subject, course code and credits to the learning groups first." /> : null}
      </Section> : <ChoiceMenu label="Class" value={classId} disabled={locked || !term} options={[{ value: '', label: 'Choose class' }, ...classes.map(item => ({ value: item.id, label: item.name }))]} onChange={value => change(() => setClassId(value))} />}
      <Field label="Scheme name" value={name} maxLength={120} editable={!locked} onChangeText={value => change(() => setName(value))} /><Field label="Scheme code" value={code} maxLength={32} autoCapitalize="characters" editable={!locked} onChangeText={value => change(() => setCode(value.toUpperCase()))} />
      <ChoiceMenu label="Grading policy" value={policyId} disabled={locked} options={[{ value: '', label: 'Choose active policy' }, ...policies.map(item => ({ value: item.id, label: `${item.name} · v${item.version}` }))]} onChange={value => change(() => setPolicyId(value))} />
      <ChoiceMenu label="Approval" value={reviewMode} disabled={locked} options={[{ value: 'independent', label: 'Independent reviewer' }, { value: 'owner_review', label: 'Owner review' }]} onChange={value => change(() => setReviewMode(value))} />
      {policy?.configuration.result_format === 'gpa' ? <><Field label="Programme key" value={programme} maxLength={80} autoCapitalize="characters" editable={!locked} onChangeText={value => change(() => setProgramme(value))} /><Field label="Term number" value={termIndex} keyboardType="number-pad" editable={!locked} onChangeText={value => change(() => setTermIndex(value))} /></> : null}
      <ControlButton title="Review scheme" disabled={locked || !policies.length} onPress={() => { if (valid()) setReviewed(signature); }} />
    </View> : policy ? <Section title="Review scheme"><Facts items={[{ label: 'Scheme', value: `${name} · ${code}` }, { label: 'Audience', value: course ? `${offeringIds.length} course offerings` : selectedClass?.name ?? 'Unavailable' }, { label: 'Term', value: `${term?.name} · ${term?.academic_year}` }, { label: 'Policy', value: `${policy.name} · v${policy.version}` }, { label: 'Approval', value: reviewMode === 'independent' ? 'Independent reviewer' : 'Owner review' }, ...(policy.configuration.result_format === 'gpa' ? [{ label: 'Programme', value: `${programme.trim().toUpperCase()} · term ${termIndex}` }] : [])]} />
      {course ? selected.map((item, index) => <Row key={offeringIds[index]} title={item?.name ?? 'Course unavailable'} detail={item?.academic_context ? `${item.academic_context.course_code} · ${item.academic_context.credits} credits` : 'Review current course details again.'} variant="plain" />) : null}
      {reviewed !== signature ? <Notice tone="warning" message="The selected source changed after review. Review the latest course and policy details before saving." /> : null}
      <PolicyDetails configuration={policy.configuration} /><ControlButton title="Edit details" kind="secondary" disabled={locked} onPress={() => setReviewed(null)} /><ControlButton title="Create draft scheme" disabled={locked || reviewed !== signature} busy={writer.busy} onPress={save} /></Section> : <Notice tone="warning" message="The reviewed grading policy is unavailable. Refresh and review the scheme again." />}
    {error ? <Notice tone="warning" message={error} /> : null}
  </>;
}

export function ReportSubjectForm({ root, href, writer, data, detail, disabled, onDirtyChange }: FormProps & { data: Extract<AcademicReportWorkspace, { mode: 'admin' }>; detail: GradingSchemeDetail }) {
  const [revision] = useState(detail.scheme.revision), [subjectId, setSubjectId] = useState(''), [offeringId, setOfferingId] = useState(''), [credits, setCredits] = useState(''), [courseCode, setCourseCode] = useState(''), [pass, setPass] = useState('');
  const [components, setComponents] = useState<{ code: string; name: string; weight: string; assessment_ids: string[] }[]>([{ ...initialReportComponent, assessment_ids: [] }]), [error, setError] = useState(''), [reviewed, setReviewed] = useState<string | null>(null);
  const course = reportContextKind(detail.scheme) === 'learning_offering', offering = reportPlanOffering(data.references, detail.scheme, offeringId), academic = offering?.academic_context;
  const selectedSubject = course ? academic?.subject_id ?? '' : subjectId, selectedCredits = course ? academic?.credits ?? null : credits.trim() ? Number(credits) : null, selectedCode = course ? academic?.course_code ?? null : courseCode.trim().toUpperCase() || null;
  const eligible = eligibleReportAssessments(data.references, detail.scheme, selectedSubject, course ? offeringId : undefined);
  const needsCredits = course || detail.scheme.result_policy?.configuration.result_format === 'gpa' || detail.scheme.result_policy?.configuration.aggregation === 'credit_weighted';
  const dirty = reportSubjectDraftDirty({ offeringId, subjectId, credits, courseCode, pass, components });
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const stale = revision !== detail.scheme.revision, locked = disabled || writer.locked || stale || detail.scheme.status !== 'draft';
  const input = { ...(course ? { offeringId } : {}), subjectId: selectedSubject, credits: needsCredits ? selectedCredits : null, courseCode: needsCredits ? selectedCode : null, components: components.map(component => ({ code: component.code.trim().toUpperCase(), name: component.name.trim(), weight_percentage: Number(component.weight), assessment_ids: component.assessment_ids })) };
  const signature = JSON.stringify({ input, pass, revision, offering, policy: detail.scheme.result_policy });
  const change = (work: () => void) => { setReviewed(null); setError(''); work(); };
  const update = (index: number, patch: Partial<typeof components[number]>) => change(() => setComponents(current => current.map((component, item) => index === item ? { ...component, ...patch } : component)));
  function valid() { const problem = subjectPlanError(input, detail, data) ?? (pass && (!Number.isFinite(Number(pass)) || Number(pass) < 0 || Number(pass) > 100) ? 'Pass percentage must be between zero and one hundred.' : null); setError(problem || ''); return !problem; }
  function submit() {
    if (!locked && reviewed === signature && valid()) void writer.run({ ownerHref: href, endpoint: `${root}/schemes/${encodeURIComponent(detail.scheme.id)}/subjects/`, method: 'PUT', body: { subject_id: input.subjectId, ...(course ? { offering_id: offeringId } : {}), expected_revision: revision, credits: input.credits, course_code: input.courseCode, pass_percentage: detail.scheme.result_policy ? null : pass ? Number(pass) : null, components: input.components } });
  }
  return <Section title={course ? 'Course grading plan' : 'Subject grading plan'}>
    {stale ? <Notice tone="warning" message="This scheme changed. Your plan has not been applied. Review the saved scheme before starting again." /> : null}
    {!reviewed ? <>
      {course ? <><ChoiceMenu label="Course offering" value={offeringId} disabled={locked} options={[{ value: '', label: 'Choose a selected course' }, ...reportTermOfferings(data.references, detail.scheme.term_id).filter(item => detail.scheme.offering_ids?.includes(item.id)).map(item => ({ value: item.id, label: `${item.academic_context!.course_code} · ${item.name}` }))]} onChange={value => change(() => { setOfferingId(value); setComponents(current => current.map(component => ({ ...component, assessment_ids: [] }))); })} />{academic ? <Facts items={[{ label: 'Subject', value: academic.subject_name }, { label: 'Course code', value: academic.course_code }, { label: 'Credits', value: academic.credits }]} /> : null}</> : <ChoiceMenu label="Subject" value={subjectId} disabled={locked} options={[{ value: '', label: 'Choose subject' }, ...data.references.subjects.map(item => ({ value: item.id, label: item.name }))]} onChange={value => change(() => { setSubjectId(value); setComponents(current => current.map(component => ({ ...component, assessment_ids: [] }))); })} />}
      {!detail.scheme.result_policy ? <Field label="Pass percentage (optional)" value={pass} keyboardType="decimal-pad" editable={!locked} onChangeText={value => change(() => setPass(value))} /> : <Notice message="Pass decisions follow the frozen grading policy." />}
      {needsCredits && !course ? <><Field label="Stable course code" value={courseCode} maxLength={80} editable={!locked} onChangeText={value => change(() => setCourseCode(value))} /><Field label="Course credits" value={credits} keyboardType="decimal-pad" editable={!locked} onChangeText={value => change(() => setCredits(value))} /></> : null}
      {components.map((component, index) => <Section key={index} title={`Component ${index + 1}`}>
        <Field label={`Component name ${index + 1}`} value={component.name} maxLength={100} editable={!locked} onChangeText={value => update(index, { name: value })} /><Field label={`Component code ${index + 1}`} value={component.code} maxLength={32} editable={!locked} onChangeText={value => update(index, { code: value })} /><Field label={`Weight percentage ${index + 1}`} value={component.weight} keyboardType="decimal-pad" editable={!locked} onChangeText={value => update(index, { weight: value })} />
        <ChoiceMenu label={`Add published assessment to component ${index + 1}`} value="" disabled={locked || !eligible.length} options={[{ value: '', label: 'Choose assessment' }, ...eligible.filter(item => !components.some(other => other.assessment_ids.includes(item.id))).map(item => ({ value: item.id, label: `${item.title} · ${item.maximum_marks} marks · release ${item.publication_sequence}` }))]} onChange={value => { if (value && eligible.some(item => item.id === value)) update(index, { assessment_ids: [...component.assessment_ids, value] }); }} />
        {component.assessment_ids.map(id => <View key={id}><Row title={eligible.find(item => item.id === id)?.title ?? 'Source unavailable'} detail="Published assessment" /><ControlButton title={`Remove assessment ${eligible.find(item => item.id === id)?.title ?? id}`} kind="secondary" disabled={locked} onPress={() => update(index, { assessment_ids: component.assessment_ids.filter(value => value !== id) })} /></View>)}
        {components.length > 1 ? <ControlButton title={`Remove component ${index + 1}`} kind="secondary" disabled={locked} onPress={() => change(() => setComponents(current => current.filter((_, item) => item !== index)))} /> : null}
      </Section>)}
      {!eligible.length && selectedSubject ? <Notice message="No published assessments are available for this exact course or class, subject and term." /> : null}
      <ControlButton title="Add component" kind="secondary" disabled={locked || components.length >= 20} onPress={() => change(() => setComponents(current => [...current, { code: '', name: '', weight: '', assessment_ids: [] }]))} />
      <ControlButton title="Review subject plan" disabled={locked} onPress={() => { if (valid()) setReviewed(signature); }} />
    </> : <Section title="Review subject plan"><Facts items={[{ label: course ? 'Course' : 'Subject', value: offering?.name ?? data.references.subjects.find(item => item.id === selectedSubject)?.name ?? 'Unavailable' }, ...(needsCredits ? [{ label: 'Course code', value: selectedCode ?? 'Unavailable' }, { label: 'Credits', value: selectedCredits ?? 'Unavailable' }] : [])]} />
      {components.map((component, index) => <Section key={index} title={`${component.name} · ${component.weight}%`}>{component.assessment_ids.map(id => <Row key={id} title={eligible.find(item => item.id === id)?.title ?? 'Published source unavailable'} variant="plain" />)}</Section>)}
      {reviewed !== signature ? <Notice tone="warning" message="Course or grading details changed after review. Review the current plan before saving." /> : null}
      <ControlButton title="Edit plan" kind="secondary" disabled={locked} onPress={() => setReviewed(null)} /><ControlButton title="Save subject plan" disabled={locked || reviewed !== signature} busy={writer.busy} onPress={submit} />
    </Section>}
    {error ? <Notice tone="warning" message={error} /> : null}
  </Section>;
}
