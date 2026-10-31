#!/usr/bin/env node
/** Owner-authorized fictional fixture. Ordinary domain APIs only; default is plan. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AARANYA_CALENDAR_YEAR as year, AARANYA_CALENDAR_ARRANGEMENTS as arrangements,
  AARANYA_CALENDAR_REFERENCES as references } from './aaranya-calendar-year.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const months = Array.from({ length: 12 }, (_, index) => {
  const start = new Date(Date.UTC(2026, 6 + index, 1)), end = new Date(Date.UTC(2026, 7 + index, 0));
  return { from: start.toISOString().slice(0, 10), until: end.toISOString().slice(0, 10) };
});

export function coherentContext(setup, planning, days) {
  if (setup.school?.id !== year.school_id || setup.school.name !== year.institution_name || planning.school_id !== year.school_id)
    throw new Error('The exact owner-authorized fictional Aaranya institution is required.');
  if (!setup.campuses.some(c => c.id === '9af3ca14-0096-4b41-b36b-0e7bbfaf4480' && c.code === 'AIT-MAIN'))
    throw new Error('The retained Aaranya campus identity changed.');
  const terms = {};
  for (const key of ['semester_i', 'semester_ii']) {
    const matches = planning.terms.filter(t => t.academic_year === '2026-27' && t.starts_on === year[key].starts_on && t.ends_on === year[key].ends_on);
    if (matches.length !== 1 || matches[0].is_active !== (key === 'semester_i'))
      throw new Error(`The retained ${key} dates or activation changed. Review the annual fixture against current academic records.`);
    terms[key] = matches[0];
  }
  for (const date of ['2026-11-09', '2026-11-10', '2026-11-11']) {
    if (!days.results.some(day => day.date === date && day.is_instructional === false))
      throw new Error('The existing 9–11 November teaching break must be retained, not recreated as information.');
  }
  if (setup.classes.length < 52 || !planning.classes.some(c => c.grade === 'M.Tech Data Eng' && c.section === '2026 · Sem I'))
    throw new Error('The retained programme/cohort structure must be reviewed before authoring its year.');
  return { terms, preserved: digest({ classes: setup.classes, staff: setup.staff,
    term_states: planning.terms, overrides: days.results }) };
}

export function publicationRequests(context) {
  return arrangements.map(item => {
    const reference = references.find(ref => ref.key === item.source_pattern);
    if (!reference) throw new Error('Unreviewed annual source pattern.');
    const term = item.academic_term_key ? context.terms[item.academic_term_key] : null;
    if (item.academic_term_key && (!term || item.starts_on < term.starts_on || item.ends_on > term.ends_on))
      throw new Error(`A published milestone contradicts its linked academic term: ${item.fixture_key}`);
    return { fixture_key: item.fixture_key, fields: { title: item.title, description: item.description,
      starts_on: item.starts_on, ends_on: item.ends_on, category_label: item.category,
      academic_term_id: term?.id ?? null,
      provenance: { fixture_key: item.fixture_key, source_note: `${year.fixture}. Authored fictional dates; pattern reference: ${reference.url}` },
    } };
  });
}

export class AaranyaCalendarClient {
  cookies = new Map();
  constructor(api = 'http://127.0.0.1:8000', origin = 'http://127.0.0.1:5173') {
    const url = new URL(api);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('The fixture writer is limited to a reviewed local runtime.');
    this.api = api.replace(/\/$/, ''); this.origin = origin;
  }
  async request(path, method = 'GET', body, key) {
    const headers = new Headers({ Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), Origin: this.origin });
    if (method !== 'GET') { headers.set('X-CSRFToken', this.cookies.get('csrftoken') ?? ''); headers.set('Idempotency-Key', key ?? randomUUID()); }
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await fetch(this.api + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
    for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';')[0], at = pair.indexOf('='); if (at > 0) this.cookies.set(pair.slice(0, at), pair.slice(at + 1)); }
    const raw = await response.text(); let value;
    try { value = raw ? JSON.parse(raw) : null; } catch { throw new Error(`${method} ${path}: unreadable response (${response.status}); retain the same command key.`); }
    if (!response.ok) { const error = new Error(`${method} ${path}: ${response.status} ${JSON.stringify(value).slice(0, 800)}`); error.status = response.status; throw error; }
    return value;
  }
  async login(credentials) {
    await this.request('/api/v1/auth/csrf/');
    const result = await this.request('/api/v1/auth/login/', 'POST', { identifier: credentials.accounts.director.email, password: credentials.password });
    if (result.mfa_required) throw new Error('Complete the ordinary MFA flow; no fixture bypass is supported.');
    await this.request('/api/v1/auth/active-school/', 'POST', { school_id: year.school_id });
    const environment = await this.request('/api/v1/auth/execution-environment/', 'POST', { mode: 'live' });
    if (environment.mode && environment.mode !== 'live') throw new Error('Explicit Live authoring was not confirmed.');
  }
  async logout() { if (this.cookies.size) await this.request('/api/v1/auth/logout/', 'POST', {}); this.cookies.clear(); }
}

async function sourceContext(client) {
  const [setup, planning, days] = await Promise.all([
    client.request(`/api/v1/schools/${year.school_id}/institution-setup/`), client.request('/api/v1/schedule-planning'),
    client.request(`/api/v1/calendar/days/?school_id=${year.school_id}&from=2026-11-09&to=2026-11-11`),
  ]);
  return coherentContext(setup, planning, days);
}

export async function run({ apply = false, api = process.env.AARANYA_API_URL ?? 'http://127.0.0.1:8000',
  stateDirectory = resolve(process.env.AARANYA_CALENDAR_STATE ?? '.runtime/aaranya-calendar-year-20261028'),
  credentialPath = resolve(process.env.AARANYA_CREDENTIALS ?? '.runtime/iiita-campus/credentials.json') } = {}) {
  const client = new AaranyaCalendarClient(api), base = `/api/v1/schools/${year.school_id}/campus-dates`;
  await client.login(JSON.parse(await readFile(credentialPath, 'utf8')));
  try {
    const context = await sourceContext(client), requests = publicationRequests(context);
    const summary = { fixture: year.fixture, school_id: year.school_id, from: year.starts_on, until: year.ends_on,
      published_arrangements: requests.length, linked_term_records: requests.filter(r => r.fields.academic_term_id).length,
      preserved_break: '2026-11-09..2026-11-11', future_term_remains_inactive: true, plan_hash: digest(requests) };
    if (!apply) { console.log(JSON.stringify({ status: 'read_only_plan', ...summary })); return summary; }
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    const statePath = resolve(stateDirectory, 'state.json'); let state;
    try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; state = { fixture: year.fixture, school_id: year.school_id, api, plan_hash: summary.plan_hash, commands: {}, records: {} }; }
    if (state.fixture !== year.fixture || state.school_id !== year.school_id || state.api !== api || state.plan_hash !== summary.plan_hash) throw new Error('Retained annual authoring state differs; review it without overwriting.');
    const save = async () => { const temporary = statePath + '.tmp'; await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 }); await rename(temporary, statePath); };
    const existing = new Map();
    for (const range of months) for (let page = 1; page <= 10; page++) {
      const result = await client.request(`${base}?${new URLSearchParams({ ...range, page: String(page) })}`);
      if (!result.can_manage) throw new Error('Current explicit Calendar publication authority is required.');
      for (const item of result.items) if (item.provenance?.fixture_key) {
        const previous = existing.get(item.provenance.fixture_key);
        if (previous && previous.id !== item.id) throw new Error('Duplicate retained fixture identities require review.');
        existing.set(item.provenance.fixture_key, item);
      }
      if (page >= result.total_pages) break;
      if (page === 10) throw new Error('The bounded preflight did not read the complete current year.');
    }
    let created = 0, retained = 0;
    for (const { fixture_key: key, fields } of requests) {
      const current = existing.get(key);
      if (current) {
        if (current.state !== 'published' || digest(Object.fromEntries(Object.keys(fields).map(field => [field, current[field]]))) !== digest(fields))
          throw new Error(`A retained annual record was customized; it will not be overwritten: ${key}`);
        state.records[key] = { id: current.id, revision: current.revision }; retained++; await save(); continue;
      }
      if (state.records[key]) throw new Error(`A retained publication disappeared; review before recreating: ${key}`);
      state.commands[key] ??= { idempotency_key: randomUUID(), fields_hash: digest(fields) };
      if (state.commands[key].fields_hash !== digest(fields)) throw new Error('A pending publication payload changed.');
      await save();
      const item = await client.request(base, 'POST', { ...fields, idempotency_key: state.commands[key].idempotency_key }, state.commands[key].idempotency_key);
      if (item.school_id !== year.school_id || item.state !== 'published' || digest(Object.fromEntries(Object.keys(fields).map(field => [field, item[field]]))) !== digest(fields))
        throw new Error('Publication readback did not match its exact reviewed request.');
      state.records[key] = { id: item.id, revision: item.revision }; created++; await save();
    }
    const after = await sourceContext(client);
    if (context.preserved !== after.preserved) throw new Error('Academic/person structure or retained teaching overrides changed during import; review the connected source records.');
    const receipt = { status: 'published', ...summary, created, retained, term_ids: Object.fromEntries(Object.entries(context.terms).map(([k, v]) => [k, v.id])),
      source_structure_hash_before: context.preserved, source_structure_hash_after: after.preserved,
      no_enrollment_or_evidence_mutation: true, records: state.records, verified_at: new Date().toISOString() };
    await writeFile(resolve(stateDirectory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ ...summary, status: receipt.status, created, retained, source_structure_preserved: true })); return receipt;
  } finally { await client.logout(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.slice(2).some(argument => argument !== '--apply')) throw new Error('Only --apply is supported; default is a read-only plan.');
  await run({ apply: process.argv.includes('--apply') });
}
