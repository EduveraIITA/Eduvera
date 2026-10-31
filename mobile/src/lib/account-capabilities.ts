import type { WorkspaceManifest, WorkspaceMoreItem } from '../../../packages/contracts/src/workspace';

export type AccountConnectionAudience = 'principal' | 'teacher' | 'parent' | 'student';
export interface AccountConnectionContext { key: string; label: string; detail: string; audience: AccountConnectionAudience; studentId?: string }
export interface AccountProPreference { enabled: boolean; preview: true }
export interface AccountMemory { id: string; portal: AccountConnectionAudience; category: 'communication_preference' | 'workflow_preference' | 'app_knowledge'; topic: string; content: string; expires_at: string }
export interface AccountMemories { items: AccountMemory[]; budget: { used_tokens: number; max_tokens: number; used_items: number; max_items: number }; contract: string }
export interface AccountChannelConnection { portal: AccountConnectionAudience; student_id: string | null; linked_at: string; last_inbound_at: string | null; last_outbound_at: string | null; uncertain_replies?: number }
export interface AccountChannelProvider { name: 'telegram' | 'whatsapp'; configured: boolean; label: string; username?: string; availability?: 'ready' | 'temporarily_unavailable' | 'not_configured'; connection: AccountChannelConnection | null }
const audiences = ['principal', 'teacher', 'parent', 'student'];
const categories = ['communication_preference', 'workflow_preference', 'app_knowledge'];
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The account response could not be verified.'); return value as Record<string, unknown>; };
const text = (value: unknown, maximum: number) => typeof value === 'string' && value.length > 0 && value.length <= maximum;
export const accountUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const instant = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function accountMoreItems(manifest: WorkspaceManifest): readonly WorkspaceMoreItem[] { return manifest.more.groups?.length ? manifest.more.groups.flatMap(group => group.items) : [...manifest.more.setup, ...(manifest.more.other ?? [])]; }
/** Compatibility audience keys select existing APIs; they never grant authority. */
export function accountConnectionContexts(manifest: WorkspaceManifest): AccountConnectionContext[] {
  const result: AccountConnectionContext[] = [], items = accountMoreItems(manifest);
  if (items.some(item => item.key === 'governance')) result.push({ key: 'institution', label: 'Institution operations', detail: 'Institution-wide work visible to you', audience: 'principal' });
  if (items.some(item => item.key === 'responsibilities')) result.push({ key: 'assigned-work', label: 'My assigned work', detail: 'Schedules and updates from active responsibilities', audience: 'teacher' });
  for (const scope of manifest.areas.flatMap(area => [...area.scopes, ...area.surfaces.flatMap(surface => surface.scopes)])) {
    if (!['self', 'dependent'].includes(scope.kind) || scope.id && !accountUuid(scope.id) || scope.kind === 'dependent' && !scope.id) continue;
    const key = `${scope.kind}:${scope.id ?? 'self'}`; if (result.some(context => context.key === key)) continue;
    result.push({ key, label: scope.kind === 'dependent' ? scope.label || 'Linked learner' : 'My learning', detail: scope.kind === 'dependent' ? 'Learning schedule and updates available through this relationship' : 'My timetable, assessments and campus dates', audience: scope.kind === 'dependent' ? 'parent' : 'student', ...(scope.id ? { studentId: scope.id } : {}) });
  }
  return result;
}
/** An explicit stale selection never silently changes to another learner. */
export function selectedAccountConnection(contexts: readonly AccountConnectionContext[], requested: string) { return requested ? contexts.find(context => context.key === requested) ?? null : contexts[0] ?? null; }
export function accountMemoryAvailable(mode: 'live' | 'simulation', schoolId: string | null, _proEnabled: boolean) { return mode === 'live' && !!schoolId; }
export function parseAccountProPreference(value: unknown): AccountProPreference { const row = object(value); if (typeof row.enabled !== 'boolean' || row.preview !== true) throw new Error('Your Pro preference could not be verified.'); return { enabled: row.enabled, preview: true }; }
export function parseAccountMemories(value: unknown): AccountMemories {
  const row = object(value), budget = object(row.budget);
  if (!Array.isArray(row.items) || row.items.length > 1024 || !text(row.contract, 100) || !['used_tokens', 'max_tokens', 'used_items', 'max_items'].every(key => count(budget[key])) || Number(budget.used_items) !== row.items.length || Number(budget.used_items) > Number(budget.max_items)) throw new Error('Assistant memory could not be verified.');
  const ids = new Set<string>();
  const items = row.items.map(value => { const item = object(value); if (!accountUuid(item.id) || ids.has(item.id) || !audiences.includes(String(item.portal)) || !categories.includes(String(item.category)) || !text(item.topic, 100) || !text(item.content, 12000) || !instant(item.expires_at)) throw new Error('Assistant memory could not be verified.'); ids.add(item.id); return { id: item.id, portal: item.portal, category: item.category, topic: item.topic, content: item.content, expires_at: item.expires_at } as AccountMemory; });
  return { items, budget: budget as AccountMemories['budget'], contract: row.contract as string };
}
export const memoryCategoryLabel = (category: AccountMemory['category']) => ({ communication_preference: 'Communication', workflow_preference: 'Workflow', app_knowledge: 'App familiarity' })[category];
export const accountMemoryListFingerprint = (items: readonly AccountMemory[]) => JSON.stringify(items.map(item => [item.id, item.portal, item.category, item.topic, item.content, item.expires_at]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
export function accountMemoryDeletePath(id: string) { if (!accountUuid(id)) throw new Error('Choose a current remembered preference.'); return `/api/v1/agent/memories/${id}`; }
export function assertMemoryDeleted(value: unknown, id: string) { const row = object(value); if (row.deleted !== true || row.id !== id) throw new Error('The exact memory deletion was not confirmed.'); }
export function assertMemoriesCleared(value: unknown) { const row = object(value); if (row.cleared !== true || !count(row.count)) throw new Error('Memory clearing was not confirmed.'); }
export function parseAccountChannels(value: unknown): AccountChannelProvider[] {
  const row = object(value); if (!Array.isArray(row.providers) || row.providers.length > 2) throw new Error('Messaging connections could not be verified.');
  const seen = new Set<string>();
  return row.providers.map(value => { const provider = object(value); if (!['telegram', 'whatsapp'].includes(String(provider.name)) || seen.has(String(provider.name)) || typeof provider.configured !== 'boolean' || !text(provider.label, 100) || provider.username !== undefined && !text(provider.username, 100) || provider.availability !== undefined && !['ready', 'temporarily_unavailable', 'not_configured'].includes(String(provider.availability))) throw new Error('Messaging connections could not be verified.'); seen.add(String(provider.name));
    let connection: AccountChannelConnection | null = null;
    if (provider.connection !== null) { const linked = object(provider.connection); if (!audiences.includes(String(linked.portal)) || linked.student_id !== null && !accountUuid(linked.student_id) || !instant(linked.linked_at) || linked.last_inbound_at !== null && !instant(linked.last_inbound_at) || linked.last_outbound_at !== null && !instant(linked.last_outbound_at) || linked.uncertain_replies !== undefined && !count(linked.uncertain_replies)) throw new Error('Messaging connections could not be verified.'); connection = linked as unknown as AccountChannelConnection; }
    return { name: provider.name, configured: provider.configured, label: provider.label, ...(provider.username ? { username: provider.username } : {}), ...(provider.availability ? { availability: provider.availability } : {}), connection } as AccountChannelProvider;
  });
}
export function accountChannelBody(provider: AccountChannelProvider['name'], context: AccountConnectionContext) { if (!['telegram', 'whatsapp'].includes(provider) || !audiences.includes(context.audience) || context.studentId && !accountUuid(context.studentId) || context.audience === 'parent' && !context.studentId || ['principal', 'teacher'].includes(context.audience) && context.studentId) throw new Error('Choose an exact available connection scope.'); return { provider, portal: context.audience, ...(context.studentId ? { student_id: context.studentId } : {}) }; }
export function parseAccountChannelLink(value: unknown, provider: AccountChannelProvider): { url: string; expiresAt: string } {
  const row = object(value); if (provider.name !== 'telegram' || row.provider !== provider.name || !instant(row.expires_at) || typeof row.connect_url !== 'string') throw new Error('The private provider link could not be verified.');
  let url: URL; try { url = new URL(row.connect_url); } catch { throw new Error('The private provider link could not be verified.'); }
  const username = provider.username?.replace(/^@/, '');
  if (url.protocol !== 'https:' || url.hostname !== 't.me' || url.username || url.password || url.port || url.hash || !/^\/[A-Za-z0-9_]{5,64}$/.test(url.pathname) || username && url.pathname !== `/${username}` || [...url.searchParams.keys()].length !== 1 || url.searchParams.getAll('start').length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('start') ?? '')) throw new Error('The private provider link could not be verified.');
  return { url: url.toString(), expiresAt: row.expires_at as string };
}
export function assertAccountChannelDisconnected(value: unknown, provider: AccountChannelProvider['name']) { const row = object(value); if (row.provider !== provider || row.connected !== false) throw new Error('The messaging disconnection was not confirmed.'); }
export const accountChannelFingerprint = (provider: AccountChannelProvider | undefined) => JSON.stringify(provider ? [provider.name, provider.configured, provider.username ?? null, provider.connection ? [provider.connection.portal, provider.connection.student_id, provider.connection.linked_at] : null] : null);
export function accountChannelLinkCurrent(link: { provider: AccountChannelProvider['name']; expiresAt: string; source: string }, providers: readonly AccountChannelProvider[] | undefined, now = Date.now()) { return Number.isFinite(Date.parse(link.expiresAt)) && Date.parse(link.expiresAt) > now && !!providers && accountChannelFingerprint(providers.find(provider => provider.name === link.provider)) === link.source; }
export function accountQueryBelongsToActor(key: readonly unknown[], actorId: string, origin: string) { try { if (key[0] !== 'campus' || typeof key[1] !== 'string') return false; const binding: unknown = JSON.parse(key[1]); if (!Array.isArray(binding) || binding.length !== 2 || binding[0] !== origin || typeof binding[1] !== 'string') return false; const scope: unknown = JSON.parse(binding[1]); return Array.isArray(scope) && scope.length === 4 && scope[0] === actorId; } catch { return false; } }
