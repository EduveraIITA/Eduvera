#!/usr/bin/env node
/** Connected fictional sources, through the same authorized APIs as the UI. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AaranyaCalendarClient, coherentContext, digest } from './seed-aaranya-calendar-year.mjs';
import { AARANYA_CALENDAR_YEAR as year, AARANYA_CALENDAR_PROVENANCE as provenance,
  AARANYA_OPTIONAL_EVENT_CANDIDATES as eventCandidates,
  AARANYA_OPTIONAL_ASSESSMENT_CANDIDATES as assessmentCandidates } from './aaranya-calendar-year.mjs';

export const fixture = 'aaranya-calendar-connected-2026-27-v1';
export const weeks = Object.freeze([
  { starts_on: '2026-11-09', ends_on: '2026-11-15' },
  { starts_on: '2026-12-21', ends_on: '2026-12-27' },
  { starts_on: '2027-02-08', ends_on: '2027-02-14' },
]);
const diningBase = `/api/v1/schools/${year.school_id}/dining`;
const assessmentBase = `/api/v1/schools/${year.school_id}/assessments`;
const instant = (date, time) => `${date}T${time}:00+05:30`;
const toUtc = value => new Date(value).toISOString();
const cleanDay = day => Object.fromEntries(['weekday', 'menu_text', 'starts_at', 'ends_at', 'end_day_offset',
  'space_id', 'operator_person_id', 'start_fold', 'end_fold'].map(key => [key, day[key]]));
const marker = key => `[${fixture}:${key}]`;
const overlap = (start, end, otherStart, otherEnd) => Date.parse(start) < Date.parse(otherEnd) && Date.parse(end) > Date.parse(otherStart);
const one = (items, predicate, message) => {
  const found = items.filter(predicate); if (found.length !== 1) throw new Error(message); return found[0];
};
const owned = (record, key, field = 'description') => record[field]?.includes(marker(key));
const pick = (record, keys) => Object.fromEntries(keys.map(key => [key, record[key]]));
export function preservationView(data, common) {
  // Owning service DTOs include their newly-created sessions. Preserve their source
  // configuration, not a changing aggregate list or viewer-specific permissions.
  return { retained: common.preserved,
    services: Object.fromEntries(Object.entries(data.services).map(([key, value]) => [key, pick(value,
      ['id', 'school_id', 'revision', 'name', 'coordinator_person_id', 'space_id', 'active', 'menu_mode', 'operations_mode', 'source_label', 'source_url', 'source_reference'])])),
    plans: Object.fromEntries(Object.entries(data.sourcePlans).map(([key, value]) => [key, { ...pick(value,
      ['id', 'series_id', 'service_id', 'revision', 'version_number', 'label', 'timezone', 'starts_on', 'ends_on', 'coordinator_person_id', 'state', 'published_at', 'stop_from']), days: value.days.map(cleanDay) }])),
    monday: pick(data.monday, ['id', 'revision', 'service_id', 'state', 'label', 'starts_at', 'ends_at', 'operator', 'coordinator', 'space_id', 'menu_text', 'count_total', 'count_receipt_id', 'updated_at']),
    issue: pick(data.issue, ['id', 'revision', 'session_id', 'state', 'title', 'handler', 'reporter', 'coordinator', 'updated_at', 'history']),
  };
}

export function validateConnectedSources(data, personas, operations) {
  const common = coherentContext(data.setup, data.planning, data.days);
  if (personas.school_id !== year.school_id || data.session.user?.active_school_id !== year.school_id
    || data.session.execution_environment?.mode !== 'live') throw new Error('Aaranya Live authoring must be explicit.');
  const cohort = one(data.planning.classes, c => c.grade === 'M.Tech Data Eng' && c.section === '2026 · Sem I', 'The existing Data Engineering Semester I cohort is required.');
  const faculty = one(data.catalog.staff, s => s.user_id === personas.accounts.faculty.user_id, 'Retained faculty account is unavailable.');
  const director = one(data.catalog.staff, s => s.user_id === data.session.user.id, 'Retained Director account is unavailable.');
  if (!data.catalog.students.some(s => s.class_section_id === cohort.id)) throw new Error('The audience has no actual enrolled members.');
  const currentVersion = data.planning.versions.filter(v => v.class_section_id === cohort.id && v.state === 'published'
    && !v.baseline && v.term_id === common.terms.semester_i.id && v.starts_on <= '2026-11-07' && v.ends_on >= '2026-11-07')
    .sort((a, b) => b.starts_on.localeCompare(a.starts_on))[0];
  if (!currentVersion) throw new Error('The current published cohort teaching plan is required.');
  const periods = currentVersion.periods;
  const subjects = assessmentCandidates.map(candidate => {
    const subject = one(data.planning.subjects, s => s.code === candidate.subject_code_hint, 'The referenced actual subject code is unavailable.');
    if (!periods.some(p => p.subject_id === subject.id)) throw new Error('Subject is not connected to the retained published cohort teaching plan.');
    const teachers = [...new Set(periods.filter(p => p.subject_id === subject.id).map(p => p.teacher_user_id).filter(Boolean))];
    if (teachers.length !== 1 || !data.assessments.references.staff.some(s => s.id === teachers[0]) || teachers[0] === director.user_id)
      throw new Error('Exactly one current subject examiner, distinct from the moderator, must be retained.');
    return { ...subject, examiner_user_id: teachers[0] };
  });
  const services = {};
  for (const key of ['lunch', 'dinner']) {
    const service = data.services[key], plan = data.sourcePlans[key], reference = operations.dining[key];
    if (service.id !== reference.service_id || !service.active || service.menu_mode !== 'native' || service.operations_mode !== 'native'
      || service.coordinator_person_id !== personas.accounts.facilities.person_id || plan.id !== reference.plan_id
      || plan.service_id !== service.id || plan.state !== 'published' || plan.starts_on !== '2026-10-26' || plan.ends_on !== '2026-11-01'
      || plan.days.length !== 7 || plan.days.some(day => day.space_id !== reference.place_id || !day.operator_person_id))
      throw new Error('Retained service, coordinator, place or menu week changed; review rather than reassign authority.');
    services[key] = { service, plan };
  }
  const eligibleSpaces = data.setup.spaces.filter(space => space.is_bookable && space.status === 'active'
    && ['classroom', 'workshop', 'laboratory', 'auditorium', 'hall', 'sports'].includes(space.kind)
    && data.catalog.places.some(place => place.id === space.id) && (space.capacity ?? 0) >= data.catalog.students.filter(s => s.class_section_id === cohort.id).length)
    .sort((a, b) => Number(!/seminar|project studio|lecture/i.test(a.name)) - Number(!/seminar|project studio|lecture/i.test(b.name)) || a.name.localeCompare(b.name));
  if (!eligibleSpaces.length) throw new Error('No current canonical venue can accommodate this actual cohort.');
  return { ...common, cohort, faculty, director, subjects, services, eligibleSpaces,
    faculty_person_id: personas.accounts.faculty.person_id, coordinator_person_id: personas.accounts.facilities.person_id,
    coordinator_user_id: personas.accounts.facilities.user_id,
    source_hash: digest(preservationView(data, common)) };
}

export function chooseEvent(candidate, context, occurrences, existing) {
  const duration = Date.parse(instant(candidate.date, candidate.ends_at_local)) - Date.parse(instant(candidate.date, candidate.starts_at_local));
  const alternatives = [...new Set([candidate.starts_at_local, '17:00', '17:30', '18:00', '08:00'])];
  for (const time of alternatives) {
    const starts_at = instant(candidate.date, time), ends_at = new Date(Date.parse(starts_at) + duration).toISOString();
    for (const space of context.eligibleSpaces) {
      const conflict = occurrences.some(item => item.state !== 'cancelled' && (!existing?.id || item.source_ref !== existing.id)
        && overlap(starts_at, ends_at, item.starts_at, item.ends_at) && (item.space_id === space.id
          || item.context_ref === context.cohort.id
          || item.participants?.some(p => p.person_id === context.faculty_person_id && p.requirement === 'required')));
      if (!conflict) return { fixture_key: candidate.fixture_key, fields: {
        school_id: year.school_id, event_type: candidate.fixture_key.includes('sports') ? 'sports' : 'workshop', subject_id: null,
        title: candidate.title, description: `${candidate.description}\n${marker(candidate.fixture_key)} Optional for the existing Data Engineering Semester I cohort. No attendance, payment or acceptance is recorded.`,
        venue: space.name, space_id: space.id, starts_at, ends_at,
        audience: { mode: 'class_sections', class_section_ids: [context.cohort.id], student_ids: [] },
        participation_requirement: 'optional', requires_rsvp: true, requires_guardian_consent: false,
        payment_required: false, payment_amount_paise: null, payment_due_on: null, payment_currency: 'INR',
        sessions: [{ title: candidate.title, session_type: 'general', venue: space.name, space_id: null, use_event_space: true,
          starts_at, ends_at, attendance_mode: 'none', participant_student_ids: [] }], checklist: [],
        staff: [{ user_id: context.faculty.user_id, role: 'organizer' }],
      }, preflight: { original_starts_at: instant(candidate.date, candidate.starts_at_local), canonical_venue_id: space.id,
        adjusted_before_publication: starts_at !== instant(candidate.date, candidate.starts_at_local) } };
    }
  }
  throw new Error(`No conflict-free bounded event window found: ${candidate.fixture_key}`);
}

export function connectedPlans(context) {
  return ['lunch', 'dinner'].flatMap(key => weeks.map(week => ({ fixture_key: `${key}-${week.starts_on}`, fields: {
    expected_revision: 0, service_id: context.services[key].service.id, service_expected_revision: context.services[key].service.revision,
    label: `Week of ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${week.starts_on}T00:00:00Z`))}`, timezone: context.services[key].plan.timezone,
    ...week, days: context.services[key].plan.days.map(day => ({ ...cleanDay(day),
      menu_text: `${provenance} Planned menu only; ingredients and dietary suitability are not verified. ${day.menu_text.replace(/^SYNTHETIC DEMO MENU — /, '')}` })),
    note: `${provenance} ${marker(`${key}-${week.starts_on}`)} This dated week only; existing coordinator, operator and place retained. No serving or count observation.`,
  } })));
}

export function assessmentPlans(context) {
  return assessmentCandidates.map((candidate, index) => ({ fixture_key: candidate.fixture_key, fields: {
    class_section_id: context.cohort.id, subject_id: context.subjects[index].id,
    title: `${context.subjects[index].name}: ${index ? 'online concept review' : 'reproducible practice review'}`,
    assessment_kind: index ? 'quiz' : 'project', maximum_marks: index ? 20 : 100, grading_policy_id: null, weight_percent: null,
    scheduled_at: toUtc(instant(candidate.date, candidate.starts_at_local)), duration_minutes: candidate.duration_minutes,
    venue: 'Online learning workspace — no physical sitting',
    instructions: `${candidate.description}\n${marker(candidate.fixture_key)} Planned review for the actual ${context.subjects[index].name} subject. No marks, result, candidate attendance or physical sitting is asserted.`,
    evidence_requirement: 'none', examiner_user_id: context.subjects[index].examiner_user_id,
    moderator_user_id: context.director.user_id, space_id: null, invigilator_user_ids: [],
  } }));
}

async function allPlans(client, serviceId) {
  const items = []; for (let page = 1; page <= 10; page++) {
    const response = await client.request(`${diningBase}/plans?service_id=${serviceId}&page=${page}`);
    items.push(...response.items); if (page >= response.total_pages) return items;
  } throw new Error('Dining plan preflight exceeded its bounded complete scan.');
}
async function allEvents(client) {
  const items = []; let cursor;
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams({ school_id: year.school_id, limit: '100', ...(cursor ? { cursor } : {}) });
    const response = await client.request(`/api/v1/campus-events?${query}`); items.push(...response.items);
    if (!response.next_cursor) return items; cursor = response.next_cursor;
  } throw new Error('Event preflight exceeded its bounded complete scan.');
}
async function occurrences(client, date) {
  const items = []; for (let page = 1; page <= 20; page++) {
    const response = await client.request(`/api/v1/schools/${year.school_id}/activities/occurrences?from=${date}&until=${date}&page=${page}&state=expected`);
    items.push(...response.items); if (page >= response.total_pages) return items;
  } throw new Error('Event conflict preflight was incomplete.');
}
async function loadSources(client, personas, operations, diningClient) {
  const [session, setup, planning, days, catalog, assessments, lunch, dinner, lunchPlan, dinnerPlan, monday, issue] = await Promise.all([
    client.request('/api/v1/auth/session/'), client.request(`/api/v1/schools/${year.school_id}/institution-setup/`),
    client.request('/api/v1/schedule-planning'), client.request(`/api/v1/calendar/days/?school_id=${year.school_id}&from=2026-11-09&to=2026-11-11`),
    client.request(`/api/v1/campus-events/catalog?school_id=${year.school_id}`), client.request(`${assessmentBase}/workspace/`),
    client.request(`${diningBase}/services/${operations.dining.lunch.service_id}`), client.request(`${diningBase}/services/${operations.dining.dinner.service_id}`),
    client.request(`${diningBase}/plans/${operations.dining.lunch.plan_id}`), client.request(`${diningBase}/plans/${operations.dining.dinner.plan_id}`),
    diningClient.request(`${diningBase}/sessions/${operations.dining.monday_session_id}`), diningClient.request(`${diningBase}/issues/${operations.dining.issue_id}`),
  ]);
  return { session, setup, planning, days, catalog, assessments, services: { lunch, dinner }, sourcePlans: { lunch: lunchPlan, dinner: dinnerPlan }, monday, issue };
}
const selectedEvent = item => ({ ...Object.fromEntries(['school_id', 'event_type', 'subject_id', 'title', 'description', 'venue', 'space_id', 'audience',
  'participation_requirement', 'requires_rsvp', 'requires_guardian_consent', 'payment_required', 'payment_amount_paise', 'payment_due_on', 'payment_currency', 'checklist'].map(k => [k, item[k]])),
  starts_at: toUtc(item.starts_at), ends_at: toUtc(item.ends_at),
  sessions: item.sessions.map(s => ({ ...Object.fromEntries(['title', 'session_type', 'venue', 'space_id', 'use_event_space', 'attendance_mode', 'participant_student_ids'].map(k => [k, s[k]])), starts_at: toUtc(s.starts_at), ends_at: toUtc(s.ends_at) })),
  staff: item.staff.filter(s => s.role === 'organizer' && s.user_id !== item.created_by).map(s => ({ user_id: s.user_id, role: s.role })) });
const assertEvent = (item, planned, context) => {
  const actual = selectedEvent(item), expected = selectedEvent({ ...planned.fields, staff: planned.fields.staff });
  // The creating Director is a native automatic organizer, not an invented second authority.
  actual.staff = actual.staff.filter(s => s.user_id !== context.director.user_id);
  if (digest(actual) !== digest(expected) || !['draft', 'published'].includes(item.status)) throw new Error('Retained Event was customized; do not overwrite it.');
};

export async function run({ apply = false, api = process.env.AARANYA_API_URL ?? 'http://127.0.0.1:8000',
  stateDirectory = resolve(process.env.AARANYA_CONNECTED_STATE ?? '.runtime/aaranya-calendar-connected-20261028'),
  credentialPath = resolve(process.env.AARANYA_CREDENTIALS ?? '.runtime/iiita-campus/credentials.json'),
  personasPath = resolve('.runtime/iiita-campus/personas-state.json'), operationsPath = resolve('.runtime/iiita-campus/operations-state.json') } = {}) {
  const [credentials, personas, operations] = await Promise.all([credentialPath, personasPath, operationsPath].map(async path => JSON.parse(await readFile(path, 'utf8'))));
  const client = new AaranyaCalendarClient(api); await client.login(credentials);
  const diningClient = new AaranyaCalendarClient(api);
  await diningClient.login({ ...credentials, accounts: { ...credentials.accounts, director: { ...credentials.accounts.director, email: personas.accounts.facilities.email } } });
  const statePath = resolve(stateDirectory, 'state.json'); let state;
  try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; state = { fixture, school_id: year.school_id, api, commands: {}, records: {} }; }
  if (state.fixture !== fixture || state.school_id !== year.school_id || state.api !== api) throw new Error('Retained source writer state belongs to another fixture or runtime.');
  const save = async () => { await mkdir(stateDirectory, { recursive: true, mode: 0o700 }); await writeFile(`${statePath}.tmp`, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 }); await rename(`${statePath}.tmp`, statePath); };
  const command = async (key, path, fields, mode, actor = client, nonIdempotent = false) => {
    const fieldsHash = digest(fields); state.commands[key] ??= { id: randomUUID(), fields_hash: fieldsHash };
    const intent = state.commands[key]; if (intent.fields_hash !== fieldsHash) throw new Error(`Retained intent changed: ${key}`);
    if (intent.attempted_at && nonIdempotent) throw new Error(`Uncertain non-idempotent creation needs owning-source reconciliation, not a blind retry: ${key}`);
    intent.attempted_at = new Date().toISOString(); await save();
    const body = mode ? { ...fields, [mode]: intent.id } : fields;
    const result = await actor.request(path, 'POST', body, intent.id); intent.result_id = result.id ?? result.assessment?.id ?? null; await save(); return result;
  };
  try {
    const sources = await loadSources(client, personas, operations, diningClient), context = validateConnectedSources(sources, personas, operations);
    const coordinatorSession = await diningClient.request('/api/v1/auth/session/');
    if (coordinatorSession.user?.id !== context.coordinator_user_id || coordinatorSession.execution_environment?.mode !== 'live') throw new Error('Retained named Dining coordinator did not sign in.');
    const currentEvents = await allEvents(client), events = [];
    for (const candidate of eventCandidates) {
      const current = currentEvents.find(item => owned(item, candidate.fixture_key));
      let event = chooseEvent(candidate, context, await occurrences(client, candidate.date), current);
      // A retained authored choice must remain exact on retry, even if a new conflict appears.
      if (state.plan?.events) {
        const retained = state.plan.events.find(item => item.fixture_key === candidate.fixture_key);
        if (retained) event = retained;
      }
      if (current) assertEvent(current, event, context); events.push(event);
    }
    // V1 published plans are immutable. Keep their reviewed payload and original
    // command keys on restart; only fresh fixtures receive the clearer week label.
    const plans = state.plan?.dining_plans ?? connectedPlans(context), assessments = assessmentPlans(context);
    for (const key of ['lunch', 'dinner']) {
      const existing = await allPlans(client, context.services[key].service.id);
      for (const planned of plans.filter(p => p.fields.service_id === context.services[key].service.id)) {
        if (existing.some(p => p.state === 'published' && p.starts_on <= planned.fields.ends_on && (!p.ends_on || p.ends_on >= planned.fields.starts_on)
          && p.label !== planned.fields.label)) throw new Error('An existing meal plan overlaps a proposed week; it will not be replaced.');
      }
    }
    const plan = { events, assessments, dining_plans: plans }, planHash = digest(plan);
    if (state.plan_hash && state.plan_hash !== planHash) throw new Error('Connected source plan changed; retain and review pending state.');
    const summary = { fixture, school_id: year.school_id, cohort_id: context.cohort.id, term_id: context.terms.semester_i.id,
      events: events.length, scheduled_nonphysical_assessments: assessments.length, dining_weeks: plans.length, dated_dining_exceptions: 3,
      plan_hash: planHash, actors: { director: { user_id: context.director.user_id, name: context.director.name.trim() },
        faculty: { user_id: context.faculty.user_id, name: context.faculty.name.trim() }, coordinator: { user_id: context.coordinator_user_id, person_id: context.coordinator_person_id, name: sources.sourcePlans.lunch.coordinator.label } },
      no_enrollment_marks_payments_rsvp_or_physical_evidence: true, existing_records_unchanged: true };
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    await writeFile(resolve(stateDirectory, 'plan.json'), JSON.stringify({ status: 'read_only_plan', ...summary, plan }, null, 2) + '\n', { mode: 0o600 });
    if (!apply) { console.log(JSON.stringify({ status: 'read_only_plan', ...summary })); return { ...summary, plan }; }
    state.plan_hash = planHash; state.plan = plan; await save();
    for (const planned of events) {
      const key = planned.fixture_key;
      let item = currentEvents.find(event => owned(event, key));
      if (!item) item = await command(`event-create:${key}`, '/api/v1/campus-events', planned.fields, 'idempotency_key');
      assertEvent(item, planned, context);
      if (item.status === 'draft') await command(`event-publish:${key}`, `/api/v1/campus-events/${item.id}/publish`, { school_id: year.school_id, expected_revision: item.revision }, 'idempotency_key');
      const readback = await client.request(`/api/v1/campus-events/${item.id}?school_id=${year.school_id}`); assertEvent(readback, planned, context);
      if (readback.status !== 'published' || readback.counts.rsvp_accepted !== 0 || readback.payment_required || readback.sessions.some(s => s.attendance_mode !== 'none')) throw new Error('Event publication asserted unexpected attendance, payment or acceptance.');
      state.records[key] = { id: item.id, revision: readback.revision, href: `/areas/events/manage/${item.id}`, cohort_id: context.cohort.id, organizer_user_id: context.faculty.user_id }; await save();
    }
    let workspace = await client.request(`${assessmentBase}/workspace/`);
    let cycle = workspace.cycles.find(c => c.code === 'CAL26P' && c.term_id === context.terms.semester_i.id);
    const cycleFields = { term_id: context.terms.semester_i.id, name: 'Semester I November–December practice reviews', code: 'CAL26P', starts_on: '2026-11-01', ends_on: '2026-12-18', result_label: 'Practice review — not yet released' };
    if (!cycle) cycle = await command('assessment-cycle', `${assessmentBase}/cycles/`, cycleFields, null, client, true);
    if (Object.entries(cycleFields).some(([key, value]) => cycle[key] !== value)) throw new Error('Existing assessment cycle was customized.');
    state.records.cycle = { id: cycle.id, term_id: cycle.term_id }; await save();
    for (const planned of assessments) {
      const key = planned.fixture_key, fields = { cycle_id: cycle.id, ...planned.fields };
      workspace = await client.request(`${assessmentBase}/workspace/`);
      let item = workspace.assessments.find(a => owned(a, key, 'instructions'));
      if (!item) item = await command(`assessment-create:${key}`, `${assessmentBase}/`, fields, null, client, true);
      if (item.assessment) item = item.assessment;
      if (item.class_section_id !== fields.class_section_id || item.subject_id !== fields.subject_id || item.instructions !== fields.instructions || toUtc(item.scheduled_at) !== fields.scheduled_at || !['draft', 'scheduled'].includes(item.status)) throw new Error('Retained nonphysical assessment changed.');
      if (item.status === 'draft') await command(`assessment-schedule:${key}`, `${assessmentBase}/${item.id}/actions/schedule/`, { expected_revision: item.revision, note: `${provenance} Schedule only; no marking or physical sitting.` }, 'idempotency_key');
      const detail = await client.request(`${assessmentBase}/${item.id}/`);
      if (detail.assessment.status !== 'scheduled' || detail.results.length || detail.publications.length || detail.exam_operation?.sitting) throw new Error('Unexpected marks, publication or physical assessment evidence.');
      state.records[key] = { id: item.id, href: `/areas/assessments/manage?assessment=${item.id}`, subject_id: fields.subject_id, examiner_user_id: fields.examiner_user_id, cohort_id: fields.class_section_id, cycle_id: cycle.id }; await save();
    }
    // Dining publication uses the retained named coordinator's own ordinary account.
    {
      for (const planned of plans) {
        const key = planned.fixture_key;
        const existing = (await allPlans(diningClient, planned.fields.service_id)).filter(p => p.label === planned.fields.label);
        if (existing.length > 1) throw new Error('Duplicate connected Dining weeks require review.');
        let item = existing[0];
        if (!item) { const saved = await command(`plan-create:${key}`, `${diningBase}/plans`, planned.fields, 'command_id', diningClient); item = await diningClient.request(`${diningBase}/plans/${saved.id}`); }
        if (item.starts_on !== planned.fields.starts_on || item.ends_on !== planned.fields.ends_on || digest(item.days.map(cleanDay)) !== digest(planned.fields.days) || item.coordinator_person_id !== context.coordinator_person_id) throw new Error('Retained Dining week was customized.');
        if (item.state === 'draft') await command(`plan-publish:${key}`, `${diningBase}/plans/${item.id}/publish`, { expected_revision: item.revision, note: `${provenance} Publish only this week; no service opening or count.` }, 'command_id', diningClient);
        item = await diningClient.request(`${diningBase}/plans/${item.id}`); if (item.state !== 'published') throw new Error('Dining week was not published.');
        state.records[key] = { id: item.id, series_id: item.series_id, revision: item.revision, service_id: item.service_id, href: `/areas/dining?plan_id=${item.id}` }; await save();
      }
      const exceptions = [
        { key: 'lunch-cancel-2026-11-09', plan: 'lunch-2026-11-09', date: '2026-11-09', action: 'cancel', note: 'Courtyard lunch is cancelled for 9 November only. No lunchtime alternative is confirmed; check Dining for the next planned service.' },
        { key: 'dinner-later-2026-11-14', plan: 'dinner-2026-11-09', date: '2026-11-14', action: 'publish_changes', starts_at: instant('2026-11-14', '20:00'), ends_at: instant('2026-11-14', '22:00'), note: 'Aravali dinner starts later for this date only, 20:00–22:00. Other dates retain the published weekly hours.' },
        { key: 'dinner-extended-2027-02-13', plan: 'dinner-2027-02-08', date: '2027-02-13', action: 'publish_changes', starts_at: instant('2027-02-13', '19:30'), ends_at: instant('2027-02-13', '22:00'), note: 'Aravali dinner is extended to 22:00 for this date only. No other meal hours are implied.' },
      ];
      for (const exception of exceptions) {
        const retained = state.records[exception.plan], path = `${diningBase}/plans/${retained.series_id}/dates/${exception.date}`;
        let date = await diningClient.request(path);
        if (date.origin !== 'session') {
          const { key, plan: _plan, date: _date, ...fields } = exception;
          await command(`dining-exception:${key}`, `${path}/actions`, { ...fields, note: `${provenance} ${marker(key)} ${fields.note}`,
            expected_plan_version_id: retained.id, expected_plan_revision: retained.revision, expected_session_revision: 0 }, 'command_id', diningClient);
          date = await diningClient.request(path);
        }
        const sessionRecord = date.session;
        if (!sessionRecord || sessionRecord.state !== (exception.action === 'cancel' ? 'cancelled' : 'published') || sessionRecord.count_receipt_id !== null || sessionRecord.count_total !== null
          || (exception.starts_at && (toUtc(sessionRecord.starts_at) !== toUtc(exception.starts_at) || toUtc(sessionRecord.ends_at) !== toUtc(exception.ends_at)))) throw new Error('Dated Dining exception differs or contains a physical count.');
        state.records[exception.key] = { id: sessionRecord.id, series_id: retained.series_id, date: exception.date, state: sessionRecord.state, href: `/areas/dining?series_id=${retained.series_id}&date=${exception.date}`, note: exception.note }; await save();
      }
    }
    const after = validateConnectedSources(await loadSources(client, personas, operations, diningClient), personas, operations);
    if (after.source_hash !== context.source_hash) throw new Error('Retained structures, source Dining week, issue or Monday session changed; review source preservation.');
    const receipt = { status: 'published_connected_sources', ...summary, records: state.records,
      source_hash_before: context.source_hash, source_hash_after: after.source_hash, verified_at: new Date().toISOString() };
    await writeFile(resolve(stateDirectory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ ...summary, status: receipt.status, receipt_path: resolve(stateDirectory, 'receipt.json') })); return receipt;
  } finally { await diningClient.logout(); await client.logout(); }
}

/** Reviewed, additive fixture upgrade. Never rewrites original publication intents. */
export async function refineDiningLabels({ api = process.env.AARANYA_API_URL ?? 'http://127.0.0.1:8000',
  stateDirectory = resolve(process.env.AARANYA_CONNECTED_LABELS_STATE ?? '.runtime/aaranya-calendar-connected-labels-20261028'),
  referencePath = resolve('.runtime/aaranya-calendar-connected-20261028/receipt.json'),
  credentialPath = resolve(process.env.AARANYA_CREDENTIALS ?? '.runtime/iiita-campus/credentials.json'),
  personasPath = resolve('.runtime/iiita-campus/personas-state.json') } = {}) {
  const [reference, credentials, personas] = await Promise.all([referencePath, credentialPath, personasPath].map(async path => JSON.parse(await readFile(path, 'utf8'))));
  if (reference.fixture !== fixture || reference.school_id !== year.school_id) throw new Error('Exact connected source receipt is required.');
  const upgrade = 'dining-readable-labels-v1', statePath = resolve(stateDirectory, 'state.json');
  let state;
  try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; state = { upgrade, fixture, school_id: year.school_id, api, commands: {} }; }
  if (state.upgrade !== upgrade || state.api !== api || state.fixture !== fixture || state.school_id !== year.school_id) throw new Error('The retained label upgrade belongs to another runtime.');
  const save = async () => { await mkdir(stateDirectory, { recursive: true, mode: 0o700 }); await writeFile(`${statePath}.tmp`, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 }); await rename(`${statePath}.tmp`, statePath); };
  const client = new AaranyaCalendarClient(api);
  await client.login({ ...credentials, accounts: { ...credentials.accounts, director: { ...credentials.accounts.director, email: personas.accounts.facilities.email } } });
  try {
    const actor = await client.request('/api/v1/auth/session/');
    if (actor.user.id !== personas.accounts.facilities.user_id || actor.execution_environment?.mode !== 'live') throw new Error('The original named coordinator in the selected Live store is required.');
    const labels = [['lunch-cancel-2026-11-09', 'Lunch unavailable'], ['dinner-later-2026-11-14', 'Later dinner service'], ['dinner-extended-2027-02-13', 'Extended dinner service']];
    const planIds = Object.entries(reference.records).filter(([key]) => /^(lunch|dinner)-\d{4}-\d{2}-\d{2}$/.test(key)).map(([, record]) => record.id);
    if (planIds.length !== 6) throw new Error('Only the six retained connected plans may be examined.');
    const plansBefore = await Promise.all(planIds.map(id => client.request(`${diningBase}/plans/${id}`)));
    const untouchedPlanHash = digest(plansBefore.map(p => ({ id: p.id, series_id: p.series_id, revision: p.revision, label: p.label, state: p.state, starts_on: p.starts_on, ends_on: p.ends_on, days: p.days.map(cleanDay) })));
    const proof = []; let changed = 0;
    for (const [key, label] of labels) {
      const source = reference.records[key]; if (!source?.id) throw new Error('A dated fixture source is missing.');
      let current = await client.request(`${diningBase}/sessions/${source.id}`);
      if (current.weekly_series_id !== source.series_id || current.weekly_date !== source.date || current.service_id !== reference.records[key.startsWith('lunch') ? 'lunch-2026-11-09' : key.includes('2027') ? 'dinner-2027-02-08' : 'dinner-2026-11-09'].service_id
        || current.count_receipt_id !== null || current.count_total !== null) throw new Error('The exact owned dated exception or its physical evidence changed.');
      const before = pick(current, ['id', 'state', 'starts_at', 'ends_at', 'menu_text', 'space_id', 'coordinator', 'operator', 'weekly_plan_id', 'weekly_series_id', 'weekly_date', 'count_total', 'count_receipt_id']);
      if (current.state === 'cancelled') {
        proof.push({ source_id: current.id, key, status: 'terminal_label_unchanged', label: current.label,
          reason: 'The native API does not permit published-label changes on a cancelled record; terminal history and cancellation are preserved.' });
        continue;
      }
      if (!['published', 'open', 'paused'].includes(current.state)) throw new Error('Only the retained published exception may be relabelled.');
      if (current.label !== label) {
        state.commands[key] ??= { id: randomUUID(), source_id: current.id, expected_revision: current.revision, label };
        const intent = state.commands[key];
        if (intent.source_id !== current.id || intent.label !== label) throw new Error('Retained label correction intent differs.');
        await save();
        await client.request(`${diningBase}/sessions/${current.id}/actions`, 'POST', {
          command_id: intent.id, expected_revision: intent.expected_revision, action: 'publish_changes', label,
          note: `${provenance} ${upgrade}: replace the misleading copied weekly label only. Existing date, service, serving hours, menu, responsibilities, publication state and all earlier notes remain unchanged.`,
        }, intent.id);
        current = await client.request(`${diningBase}/sessions/${source.id}`); changed++;
      }
      if (current.label !== label || digest(pick(current, Object.keys(before))) !== digest(before)) throw new Error('The native label correction changed more than the reviewed label.');
      const original = await client.request(`${diningBase}/plans/${current.weekly_plan_id}`);
      if (!planIds.includes(original.id)) throw new Error('The dated exception left its original plan.');
      proof.push({ source_id: current.id, key, status: 'label_verified', label, state: current.state, revision: current.revision,
        starts_at: current.starts_at, ends_at: current.ends_at, original_plan_id: current.weekly_plan_id,
        href: `/areas/dining?series_id=${source.series_id}&date=${source.date}` });
    }
    const plansAfter = await Promise.all(planIds.map(id => client.request(`${diningBase}/plans/${id}`)));
    if (untouchedPlanHash !== digest(plansAfter.map(p => ({ id: p.id, series_id: p.series_id, revision: p.revision, label: p.label, state: p.state, starts_on: p.starts_on, ends_on: p.ends_on, days: p.days.map(cleanDay) })))) throw new Error('An immutable weekly plan changed.');
    const receipt = { upgrade, fixture, api, changed, coordinator_user_id: actor.user.id, original_plan_ids: planIds,
      original_plans_unchanged: true, original_importer_commands_unchanged: true, no_physical_evidence: true, proof, verified_at: new Date().toISOString() };
    await save(); await writeFile(resolve(stateDirectory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ upgrade, api, changed, verified_labels: proof.filter(p => p.status === 'label_verified').length,
      terminal_labels_retained: proof.filter(p => p.status === 'terminal_label_unchanged').length, receipt_path: resolve(stateDirectory, 'receipt.json') }));
    return receipt;
  } finally { await client.logout(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.slice(2).some(argument => !['--apply', '--refine-labels'].includes(argument))) throw new Error('Use --apply for source creation, or --refine-labels --apply for the reviewed upgrade. The default is a read-only plan.');
  if (process.argv.includes('--refine-labels')) {
    if (!process.argv.includes('--apply')) throw new Error('The reviewed label correction requires explicit --apply.');
    await refineDiningLabels();
  } else await run({ apply: process.argv.includes('--apply') });
}
