import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { SceneResource, SceneResourceOptions } from '../../../../packages/contracts/src/campus-scenes/contracts';
import { useSession } from '../../auth/SessionProvider';
import { useApi } from '../../lib/query';
import { Button, Empty, Loading, Notice, SearchField, Section } from '../../ui/components';
import { ControlButton } from '../../ui/DomainControls';
import { useTheme } from '../../ui/theme';

export interface CampusSceneResourceScope { schoolId: string; campusId: string }
type Props = CampusSceneResourceScope & { holdingId: string | null; linkedElsewhere: ReadonlySet<string>; disabled: boolean; onChange: (holdingId: string | null) => void };
const individual = (value: SceneResource | null | undefined): value is SceneResource => !!value && typeof value.id === 'string' && !!value.id && typeof value.name === 'string' && value.tracking_mode !== 'pooled' && ['available', 'unavailable'].includes(value.state);

/** Local drawing selection only; the owning scene writer saves the link. */
export function CampusSceneResourcePicker({ schoolId, campusId, holdingId, linkedElsewhere, disabled, onChange }: Props) {
  const session = useSession(), { colors } = useTheme(), [open, setOpen] = useState(false), [input, setInput] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const scopeCurrent = session.status === 'authenticated' && !!session.user && session.schoolId === schoolId && !!schoolId && !!campusId && !session.environment.unavailable && (session.environment.mode !== 'simulation' || !!session.environment.namespace_id);
  const root = `/api/v1/schools/${encodeURIComponent(schoolId)}/campus-scenes/${encodeURIComponent(campusId)}/resources/`, path = root + '?' + new URLSearchParams({ search, page: String(page), ...(holdingId ? { holding_id: holdingId } : {}) });
  const query = useApi<SceneResourceOptions>(scopeCurrent && (open || holdingId) ? path : null, { staleTime: 30_000 });
  const data = query.isSuccess && !query.isError && query.data.page === page && Number.isSafeInteger(query.data.page_size) && query.data.page_size > 0 && Number.isSafeInteger(query.data.total) && query.data.total >= 0 && Array.isArray(query.data.items) && query.data.items.every(individual) && new Set(query.data.items.map(item => item.id)).size === query.data.items.length ? query.data : undefined;
  const selected = scopeCurrent && individual(data?.selected) && data.selected.id === holdingId ? data.selected : null, locked = disabled || !scopeCurrent, pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const latest = useRef({ scopeCurrent, scopeKey: session.scopeKey, schoolId, campusId, holdingId, linkedElsewhere, disabled, data, onChange }); latest.current = { scopeCurrent, scopeKey: session.scopeKey, schoolId, campusId, holdingId, linkedElsewhere, disabled, data, onChange };
  const choose = (id: string) => { const current = latest.current; if (!current.scopeCurrent || current.scopeKey !== session.scopeKey || current.schoolId !== schoolId || current.campusId !== campusId || current.holdingId !== holdingId || current.disabled || current.linkedElsewhere.has(id) || !current.data?.items.some(item => item.id === id && individual(item))) return; current.onChange(id); setOpen(false); };
  const clear = () => { const current = latest.current; if (current.scopeCurrent && !current.disabled && current.scopeKey === session.scopeKey && current.schoolId === schoolId && current.campusId === campusId && current.holdingId === holdingId) current.onChange(null); };
  const searchResources = () => { if (locked) return; setPage(1); setSearch(input.trim()); };
  return <Section title="Campus resource">
    <ControlButton title={open ? 'Close search' : holdingId ? 'Change resource' : 'Link resource'} disabled={locked} onPress={() => setOpen(value => !value)} />
    <Notice message="Link this fixture to an individual resource to show its recorded availability. Linking does not move the resource or report a fault." />
    {holdingId ? <View style={{ gap: 8 }}><Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>{selected ? `${selected.name}${selected.asset_tag ? ` · ${selected.asset_tag}` : ''}` : scopeCurrent && query.isPending ? 'Loading linked resource…' : 'Resource link needs checking'}</Text><ControlButton title="Clear resource link" disabled={locked} onPress={clear} /></View> : null}
    {!scopeCurrent ? <Notice tone="warning" message={session.environment.unavailable ? 'Resource links are unavailable until this Simulation is recovered. Your current link is unchanged.' : 'Confirm the selected campus and execution environment before choosing a resource. Your current link is unchanged.'} /> : null}
    {scopeCurrent && query.isError ? <><Notice tone="warning" message="Campus resources could not be loaded. Your current link is unchanged." /><ControlButton title="Try resource search again" disabled={locked} onPress={() => void query.refetch()} /></> : null}
    {open && scopeCurrent ? <>
      <SearchField label="Resource name or asset tag" placeholder="Find an individual campus resource" value={input} disabled={locked} onChangeText={value => setInput(value.slice(0, 80))} onSubmit={searchResources} onClear={() => { setInput(''); setSearch(''); setPage(1); }} busy={query.isFetching} />
      <ControlButton title="Search resources" disabled={locked || query.isFetching} onPress={searchResources} />
      {query.isPending ? <Loading label="Loading campus resources…" /> : data ? data.items.length ? data.items.map(resource => <View key={resource.id} style={{ gap: 4 }}><Button title={`Link ${resource.name}${resource.asset_tag ? ` · ${resource.asset_tag}` : ''}`} kind={holdingId === resource.id ? 'primary' : 'secondary'} disabled={locked || linkedElsewhere.has(resource.id)} onPress={() => choose(resource.id)} /><Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>{linkedElsewhere.has(resource.id) ? 'Already linked to another fixture' : resource.state === 'unavailable' ? 'Recorded unavailable' : 'Recorded available'}{holdingId === resource.id ? ' · Current link' : ''}</Text></View>) : <Empty title="No individual campus resources match this search" /> : !query.isError ? <Notice tone="warning" message="The resource catalogue could not be verified. Your current link is unchanged." /> : null}
      {data && pages > 1 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}><ControlButton title="Previous resources" disabled={locked || page <= 1 || query.isFetching} onPress={() => setPage(value => Math.max(1, value - 1))} /><Text style={{ color: colors.muted, fontSize: 14 }}>Page {page} of {pages}</Text><ControlButton title="Next resources" disabled={locked || page >= pages || query.isFetching} onPress={() => setPage(value => Math.min(pages, value + 1))} /></View> : null}
    </> : null}
  </Section>;
}
