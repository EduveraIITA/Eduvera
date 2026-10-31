import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { DiningOptions, DiningRef } from '../../../packages/contracts/src/wire/features/dining/diningApi';
import { useApi } from '../lib/query';
import { apiFetch } from '../lib/api';
import { nativeRouteHref } from '../lib/route-state';
import { useOperationContext } from '../lib/use-operation-context';
import { ScreenBack } from '../ui/BackNavigation';
import { Button, Empty, Field, Loading, Notice, Section } from '../ui/components';
import { ControlButton } from '../ui/DomainControls';
import { NativePlaceCreate } from './CanonicalSpaceCreate';
import { DomainPages, type RecordedWrite } from './ResourcesScreen';
export function DiningChoices({ root, kind, context, write, onSelected, onClose }: { root: string; kind: 'people' | 'spaces'; context?: Record<string, string>; write: RecordedWrite; onSelected: (person: DiningRef) => void; onClose: () => void }) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [adding,setAdding]=useState(false),[error,setError]=useState('');
  const params=useLocalSearchParams<Record<string,string|string[]>>(),href=nativeRouteHref('areas',{...params,path:params.path??['dining']}).href,capture=useOperationContext(JSON.stringify([href,root,kind,context]));
  const options = useApi<DiningOptions>(`${root}/options?${new URLSearchParams({ search, page: String(page), ...context })}`);
  return <><View style={adding?{display:'none'}:undefined}><Section title={kind === 'people' ? 'Choose a person' : 'Choose a place'}><ScreenBack title="Back to dining form" priority={30} onPress={onClose}/><Field label="Search choices" value={search} onChangeText={value => { setSearch(value); setPage(1); }} editable={!write.locked} />
    {kind==='spaces'&&options.data?.can_create_places&&!options.error?<ControlButton title="Add place" disabled={write.locked} onPress={()=>setAdding(true)}/>:null}{error?<Notice tone="warning" message={error}/>:null}
    {options.isPending ? <Loading /> : options.error || !options.data ? <Empty title="Choices could not be loaded" message={options.error?.message} onRetry={() => { void options.refetch(); }} /> : <>{(kind==='people'?options.data.people.filter(person=>person.has_app):options.data.spaces).map(person => <Button key={person.id} title={person.label} kind="secondary" disabled={write.locked} onPress={() => onSelected(person)} />)}<DomainPages page={page} hasMore={kind === 'people' ? options.data.people_has_more : options.data.spaces_has_more} disabled={write.locked} onChange={setPage} /></>}
    <Button title="Close choices" kind="secondary" disabled={write.locked} onPress={onClose} />
  </Section></View>{adding?<NativePlaceCreate href={href} returnTitle="Back to dining places" disabled={write.locked} onClose={()=>setAdding(false)} onCreated={place=>{void(async()=>{try{const assertCurrent=capture(),fresh=await apiFetch<DiningOptions>(`${root}/options?${new URLSearchParams({...context,space_id:place.id})}`);assertCurrent();const choice=fresh.spaces.find(row=>row.id===place.id);if(!fresh.can_create_places||!choice)throw new Error('The place was saved, but current Dining choices did not confirm it. Refresh and select a currently available place.');setAdding(false);onSelected(choice);}catch(cause){setAdding(false);setError(cause instanceof Error?cause.message:'The saved place could not be selected.');}})();}}/>:null}</>;
}
