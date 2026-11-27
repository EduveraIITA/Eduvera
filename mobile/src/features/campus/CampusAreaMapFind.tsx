import { useRef, useState } from 'react';
import { View } from 'react-native';
import { ControlButton } from '../../ui/DomainControls';
import { Field, Notice, Row, SearchField } from '../../ui/components';
import { campusAreaCoordinates, type CampusAreaPoint } from './CampusAreaMapPolicy';

export type CampusAreaSearchResult = CampusAreaPoint & { id: string; name: string; description?: string };

export function CampusAreaMapFind({ onSearch, onSelect, disabled }: {
  onSearch?: (query: string) => Promise<readonly CampusAreaSearchResult[]>;
  onSelect: (point: CampusAreaPoint) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState('');
  const [coordinates, setCoordinates] = useState('');
  const [results, setResults] = useState<readonly CampusAreaSearchResult[] | null>(null);
  const [notice, setNotice] = useState('');
  const [searching, setSearching] = useState(false);
  const searchingNow = useRef(false);
  const point = campusAreaCoordinates(coordinates);
  async function search() {
    if (!onSearch || searchingNow.current || disabled || query.trim().length < 4) return;
    searchingNow.current = true;
    setSearching(true);
    setNotice('');
    setResults(null);
    try {
      setResults(await onSearch(query.trim()));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Campus search is unavailable right now.');
    } finally {
      searchingNow.current = false;
      setSearching(false);
    }
  }
  return <View style={{ gap: 8 }}>
    {onSearch ? <>
      <SearchField label="Full campus name" value={query} onChangeText={setQuery} onSubmit={() => void search()}
        submitLabel="Find campus" submitDisabled={query.trim().length < 4} busy={searching} disabled={disabled}
        placeholder="Campus name" />
      {results?.map(result => <Row key={result.id} title={result.name} detail={result.description}
        onPress={disabled ? undefined : () => onSelect(result)} />)}
      {results?.length === 0 ? <Notice message="No exact campus names found. Try another name or enter coordinates." /> : null}
      {notice ? <Notice tone="warning" message={notice} /> : null}
    </> : null}
    <Field label="Latitude, longitude" placeholder="28.612, 77.231" value={coordinates} onChangeText={setCoordinates}
      editable={!disabled} maxLength={80} returnKeyType="go" onSubmitEditing={() => { if (point && !disabled) onSelect(point); }} />
    <ControlButton title="Center on coordinates" disabled={!point || disabled} onPress={() => { if (point) onSelect(point); }} />
  </View>;
}
