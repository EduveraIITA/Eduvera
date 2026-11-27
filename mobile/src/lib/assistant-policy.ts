import type { AgentChartData, AgentPublicWebSource, AgentStatus, AgentThread, ThreadSummary } from '../../../packages/contracts/src/wire/features/assistant/agentApi';
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string';
const instant = (value: unknown) => text(value) && Number.isFinite(Date.parse(value as string));
const fail = (): never => { throw new Error('The current assistant response could not be verified. Refresh this conversation.'); };
export function parseAssistantStatus(value: unknown): AgentStatus {
  const data = object(value);
  if (!text(data.provider) || !text(data.model) || ['ready', 'local', 'pro_features_enabled', 'confirmation_required'].some(key => typeof data[key] !== 'boolean') || data.public_web_available !== undefined && typeof data.public_web_available !== 'boolean' || !Number.isSafeInteger(data.tools) || Number(data.tools) < 0) fail();
  return data as unknown as AgentStatus;
}
export function parseAssistantThreads(value: unknown): { threads: ThreadSummary[] } {
  const data = object(value);
  if (!Array.isArray(data.threads) || data.threads.length > 20) fail();
  const ids = new Set<string>();
  for (const item of data.threads as unknown[]) { const row = object(item); if (!uuid(row.id) || ids.has(String(row.id)) || !text(row.title) || !instant(row.updated_at)) fail(); ids.add(String(row.id)); }
  return data as unknown as { threads: ThreadSummary[] };
}
export function parseAssistantChart(value: unknown): AgentChartData {
  const chart = object(value);
  if (!['line', 'bar', 'donut'].includes(String(chart.kind)) || !['records', 'percent'].includes(String(chart.unit)) || ['title', 'scope', 'from', 'to', 'note'].some(key => !text(chart[key])) || !Array.isArray(chart.points) || chart.points.length > 24 || !Number.isSafeInteger(chart.total) || !Number.isSafeInteger(chart.shown) || chart.shown !== chart.points.length || Number(chart.total) < chart.points.length) fail();
  let sum = 0;
  for (const value of chart.points as unknown[]) { const point = object(value); if (!text(point.label) || !text(point.detail) || point.value !== null && (typeof point.value !== 'number' || !Number.isFinite(point.value) || point.value < 0 || chart.unit === 'percent' && point.value > 100) || point.date !== undefined && !text(point.date) || point.end !== undefined && !text(point.end)) fail(); sum += typeof point.value === 'number' ? point.value : 0; }
  if (!Number.isFinite(sum)) fail();
  return chart as unknown as AgentChartData;
}
export function assistantPublicWebUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 1024) return;
  try {
    const url = new URL(value);
    if (url.href === value && url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash &&
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/u.test(url.hostname) &&
        !/\.(?:localhost|local|internal|home|lan|test|example|invalid|onion)$/u.test(url.hostname)) return url.href;
  } catch { /* Ignore malformed or private links. */ }
}

function isPublicWebSource(value: unknown): value is AgentPublicWebSource {
  const source = object(value);
  return uuid(source.id) && !!assistantPublicWebUrl(source.url) &&
    typeof source.title === 'string' && source.title.length > 0 && source.title.length <= 150 &&
    (source.description === undefined || typeof source.description === 'string' && source.description.length <= 220);
}

export function parseAssistantThread(value: unknown, id: string): AgentThread {
  const data = object(value);
  if (data.id !== id || !uuid(data.id) || !text(data.title) || !Array.isArray(data.runs) || data.runs.length > 50) fail();
  const ids = new Set<string>();
  for (const value of data.runs as unknown[]) {
    const run = object(value);
    if (!uuid(run.id) || ids.has(String(run.id)) || ['question', 'answer', 'progress', 'provider', 'model'].some(key => !text(run[key])) || !instant(run.created_at) || !['running', 'completed', 'confirmation', 'failed', 'cancelled'].includes(String(run.status)) || !Array.isArray(run.evidence)) fail();
    ids.add(String(run.id));
    for (const value of run.evidence as unknown[]) { const source = object(value); if (['id', 'title', 'href', 'capability'].some(key => !text(source[key])) || !instant(source.retrieved_at)) fail(); if (source.chart !== undefined) parseAssistantChart(source.chart); }
    if (run.public_web_sources !== undefined && (!Array.isArray(run.public_web_sources) ||
        run.public_web_sources.length > 3 || !run.public_web_sources.every(isPublicWebSource) ||
        new Set(run.public_web_sources.map(source => source.id)).size !== run.public_web_sources.length)) fail();
    if (run.action !== null) {
      const action = object(run.action), input = object(action.input), labels = object(action.labels), receipt = object(action.receipt);
      if (!uuid(action.id) || !text(action.title) || !text(action.href) || !instant(action.expires_at) || !['pending', 'executing', 'succeeded', 'rejected', 'expired', 'stale', 'failed', 'uncertain'].includes(String(action.status)) || !action.input || !action.labels || typeof action.labels !== 'object' || Array.isArray(action.labels) || !text(input.basis_id) || input.body !== undefined && (!input.body || typeof input.body !== 'object' || Array.isArray(input.body)) || Object.values(labels).some(label => !text(label)) || action.receipt !== null && ['message', 'request_id', 'completed_at', 'href'].some(key => receipt[key] !== undefined && !text(receipt[key]))) fail();
      if (action.contract !== undefined) { const contract = object(action.contract); if (!text(contract.summary) || contract.confirmation_label !== undefined && !text(contract.confirmation_label)) fail(); }
      if (action.preview !== undefined) { const preview = object(action.preview); if (!text(preview.date) || !text(preview.register_note) || ['student', 'class_name', 'previous_status', 'status', 'reason', 'remarks'].some(key => preview[key] !== undefined && !text(preview[key])) || preview.records !== undefined && (!Array.isArray(preview.records) || preview.records.some(item => { const row = object(item); return !text(row.student) || ['status', 'remarks'].some(key => row[key] !== undefined && !text(row[key])); }))) fail(); }
    }
  }
  return data as unknown as AgentThread;
}
/** Missing readings break the line. A null is never drawn as zero. */
export function assistantLineSegments(chart: AgentChartData) {
  const maximum = chart.unit === 'percent' ? 100 : Math.max(1, ...chart.points.map(point => point.value ?? 0));
  const segments: { x: number; y: number; index: number }[][] = [[]];
  chart.points.forEach((point, index) => { if (point.value === null) { if (segments.at(-1)!.length) segments.push([]); } else segments.at(-1)!.push({ x: 12 + index * 276 / Math.max(1, chart.points.length - 1), y: 108 - point.value / maximum * 92, index }); });
  return segments.filter(segment => segment.length);
}
export function assistantChartValue(value: number | null, unit: AgentChartData['unit']) { return value === null ? 'Not recorded' : `${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}${unit === 'percent' ? '%' : ''}`; }
/** A donut must show a complete known partition, never normalize partial data. */
export function assistantChartKind(chart: AgentChartData): AgentChartData['kind'] { return chart.kind === 'donut' && (chart.shown < chart.total || chart.points.some(point => point.value === null)) ? 'bar' : chart.kind; }
