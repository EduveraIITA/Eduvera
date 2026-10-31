import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeftIcon } from 'phosphor-react-native/src/icons/ArrowLeft';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { CubeIcon } from 'phosphor-react-native/src/icons/Cube';
import { DoorOpenIcon } from 'phosphor-react-native/src/icons/DoorOpen';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { StackIcon } from 'phosphor-react-native/src/icons/Stack';
import type { CampusScenePublished } from '../../../../packages/contracts/src/campus-scenes/contracts';
import type { CampusSceneDocument, CampusSceneElement } from '../../../../packages/contracts/src/campus-scenes/types';
import { buildingExplorerResourceStatus, type BuildingExplorerNode } from '../../../../packages/contracts/src/campus-scenes/sceneBuildingExplorer';
import { sceneBuildingFloorIds } from '../../../../packages/contracts/src/campus-scenes/sceneInterior';
import type { CampusMapAsset } from '../../../../packages/contracts/src/campus-operation';
import { isInternalHref } from '../../lib/api-policy';
import { nativeCampusBuildingPage, nativeCampusPage } from '../../lib/native-campus';
import { SearchField } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export interface CampusBuildingPanelProps {
  building: CampusSceneElement;
  scene: CampusSceneDocument;
  places: CampusScenePublished['places'];
  assets: CampusMapAsset[];
  selectedSpaceId: string | null;
  selectedElementId: string | null;
  onSelectPlace: (spaceId: string) => void;
  onSelectElement: (elementId: string) => void;
  onNavigate: (path: string) => void;
}

/** The same published place hierarchy as web, with one short native list at a time. */
export function CampusBuildingPanel(props: CampusBuildingPanelProps) {
  return <BuildingContents key={props.building.id} {...props} />;
}

function BuildingContents({ building, scene, places, assets, selectedSpaceId, selectedElementId, onSelectPlace, onSelectElement, onNavigate }: CampusBuildingPanelProps) {
  const { colors } = useTheme();
  const [parentId, setParentId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [finding, setFinding] = useState(false), [search, setSearch] = useState('');
  const [pages, setPages] = useState<Record<string, number>>({});
  const [repairPage, setRepairPage] = useState(1);
  const pageKey = `${parentId ?? 'root'}:${search.trim().toLocaleLowerCase()}`;
  const result = useMemo(() => nativeCampusBuildingPage({ building, scene, places, assets, parentId, search, page: pages[pageKey] ?? 1 }), [building, scene, places, assets, parentId, search, pages, pageKey]);
  useEffect(() => {
    const node = [...result.model.nodes.values()].find(item => item.kind === 'resource' && item.elementId === selectedElementId)
      ?? (selectedSpaceId ? result.model.nodes.get(`place:${selectedSpaceId}`) : undefined);
    setSelectedId(node?.id ?? null);
    setParentId(node?.kind === 'place' && (node.children.length || node.place.kind === 'floor') ? node.id : node?.parentId ?? null);
    setRepairPage(1);
  }, [selectedSpaceId, selectedElementId, scene, assets, building.id]);
  const parent = parentId ? result.model.nodes.get(parentId) : undefined;
  const page = parentId && !parent ? nativeCampusBuildingPage({ building, scene, places, assets, search }) : result;
  const selected = selectedId ? page.model.nodes.get(selectedId) : undefined;
  const detail = selected?.kind === 'resource' || selected?.kind === 'place' && !selected.children.length ? selected : parent;
  const mappedFloors = useMemo(() => new Set(sceneBuildingFloorIds({ ...scene, elements: scene.elements.filter(element => element.review_state === 'reviewed') }, building)), [scene, building]);
  const name = (node: BuildingExplorerNode) => {
    if (node.kind === 'place') return node.place.name;
    const place = places.find(item => item.id === node.asset.space_id);
    const prefix = place ? `${place.name} · ` : '';
    const label = prefix && node.asset.name.startsWith(prefix) && node.asset.name.slice(prefix.length).trim() ? node.asset.name.slice(prefix.length) : node.asset.name;
    return label.charAt(0).toLocaleUpperCase() + label.slice(1);
  };
  const mapped = (node: BuildingExplorerNode) => node.kind === 'resource' || (node.place.kind === 'floor' ? mappedFloors.has(node.place.id) : Boolean(node.elementId));
  const note = (node: BuildingExplorerNode) => node.kind === 'resource'
    ? [node.asset.asset_tag?.trim(), buildingExplorerResourceStatus(node.asset)].filter(Boolean).join(' · ')
    : !mapped(node) ? 'Not mapped' : node.place.kind === 'floor' ? 'Floor plan' : node.place.kind.replaceAll('_', ' ');
  const choose = (node: BuildingExplorerNode) => {
    setSelectedId(node.id); setRepairPage(1);
    if (node.kind === 'resource') onSelectElement(node.elementId);
    else {
      onSelectPlace(node.place.id);
      if (node.place.kind === 'floor' || node.children.length) setParentId(node.id);
    }
  };
  const back = () => {
    const previous = parent?.parentId ? page.model.nodes.get(parent.parentId) : undefined;
    setParentId(previous?.id ?? null); setSelectedId(previous?.id ?? null); setRepairPage(1);
    if (previous?.kind === 'place') onSelectPlace(previous.place.id); else onSelectElement(building.id);
  };
  // Only exact source-owned repair links are offered; the hierarchy grants no authority.
  const repairs = nativeCampusPage(detail?.kind === 'resource' ? detail.asset.repairs.filter(repair => isInternalHref(repair.target_path) && /^\/areas\/facilities(?:[/?#]|$)/.test(repair.target_path)) : [], repairPage);

  return <View style={styles.content}>
    <View style={styles.tools}>
      {parent ? <Pressable accessibilityRole="button" accessibilityLabel={parent.parentId ? 'Back to parent place' : 'Back to building overview'} onPress={back} style={({ pressed }) => [styles.back, { opacity: pressed ? .65 : 1 }]}><ArrowLeftIcon size={18} color={colors.link} /><Text style={[styles.actionText, { color: colors.link }]}>{parent.parentId ? 'Back' : 'Building overview'}</Text></Pressable>
        : <Text style={[styles.meta, styles.flex, { color: colors.muted }]}>{page.model.floors ? `${page.model.floors} ${page.model.floors === 1 ? 'floor' : 'floors'}` : 'Floor count not provided'}{page.model.resources ? ` · ${page.model.resources} mapped ${page.model.resources === 1 ? 'resource' : 'resources'}` : ''}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel={finding ? 'Close building search' : 'Search inside this building'} accessibilityState={{ expanded: finding }} onPress={() => { setFinding(!finding); setSearch(''); }} style={({ pressed }) => [styles.searchButton, { opacity: pressed ? .65 : 1 }]}><MagnifyingGlassIcon size={20} color={colors.link} /></Pressable>
    </View>

    {finding ? <SearchField label="Find inside this building" value={search} onChangeText={setSearch} placeholder="Place or resource name" /> : null}

    {detail ? <View style={styles.details}>
      <View style={styles.detailHeading}><Text accessibilityRole="header" style={[styles.heading, styles.flex, { color: colors.ink }]}>{name(detail)}</Text>{mapped(detail) ? <Pressable accessibilityRole="button" accessibilityLabel={`Show ${name(detail)} on map`} onPress={() => detail.kind === 'resource' ? onSelectElement(detail.elementId) : onSelectPlace(detail.place.id)} style={({ pressed }) => [styles.mapAction, { backgroundColor: colors.row, opacity: pressed ? .65 : 1 }]}><Text style={[styles.actionText, { color: colors.link }]}>Map</Text></Pressable> : null}</View>
      <Text style={[styles.meta, { color: colors.muted }]}>{note(detail)}{detail.kind === 'place' && detail.place.capacity != null ? ` · Capacity ${detail.place.capacity}` : ''}</Text>
      {detail.kind === 'place' && !mapped(detail) ? <Text style={[styles.meta, { color: colors.muted }]}>This place has no published interior plan yet.</Text> : null}
      {detail.kind === 'resource' ? <>
        {detail.asset.signal.open_reports > 0 ? <Text style={[styles.meta, { color: colors.muted }]}>{detail.asset.signal.open_reports} open {detail.asset.signal.open_reports === 1 ? 'report' : 'reports'}</Text> : null}
        {repairs.rows.map(repair => <Pressable key={repair.id} accessibilityRole="button" onPress={() => onNavigate(repair.target_path)} style={({ pressed }) => [styles.sourceAction, { borderColor: colors.border, opacity: pressed ? .65 : 1 }]}><Text style={[styles.actionText, styles.flex, { color: colors.link }]}>{repair.action_label}</Text><CaretRightIcon size={16} color={colors.link} /></Pressable>)}
        {repairs.pages > 1 ? <Pagination page={repairs.page} pages={repairs.pages} onChange={setRepairPage} label="repairs" /> : null}
      </> : null}
    </View> : null}

    {page.rows.length ? <View>{page.rows.map(node => {
      const Glyph = node.kind === 'resource' ? CubeIcon : node.place.kind === 'floor' ? StackIcon : DoorOpenIcon;
      const active = selectedId === node.id;
      return <Pressable key={node.id} accessibilityRole="button" accessibilityLabel={`${name(node)}, ${note(node)}${node.children.length ? ', open contents' : ''}`} accessibilityState={{ selected: active }} onPress={() => choose(node)} style={({ pressed }) => [styles.row, { backgroundColor: active ? colors.row : 'transparent', borderBottomColor: colors.border, opacity: pressed ? .65 : 1 }]}>
        <Glyph size={20} color={active ? colors.link : colors.muted} /><View style={styles.flex}><Text style={[styles.rowTitle, { color: colors.ink }]}>{name(node)}</Text><Text style={[styles.meta, { color: colors.muted }]}>{note(node)}</Text></View>{node.children.length || node.kind === 'place' && node.place.kind === 'floor' ? <CaretRightIcon size={16} color={colors.muted} /> : null}
      </Pressable>;
    })}</View> : <Text style={[styles.meta, { color: colors.muted }]}>{search.trim() ? 'No matching places or resources here.' : parent ? 'No further places or mapped resources are available here.' : 'No places or mapped resources are available in this building.'}</Text>}
    {page.pages > 1 ? <Pagination page={page.page} pages={page.pages} label="places" onChange={value => setPages(current => ({ ...current, [pageKey]: value }))} /> : null}
  </View>;
}

function Pagination({ page, pages, onChange, label }: { page: number; pages: number; onChange: (page: number) => void; label: string }) {
  const { colors } = useTheme();
  return <View style={styles.pagination}><Pressable accessibilityRole="button" accessibilityLabel={`Previous ${label}`} accessibilityState={{ disabled: page <= 1 }} disabled={page <= 1} onPress={() => onChange(page - 1)} style={({ pressed }) => [styles.pageAction, { opacity: page <= 1 ? .4 : pressed ? .65 : 1 }]}><Text style={[styles.actionText, { color: colors.link }]}>Previous</Text></Pressable><Text style={[styles.meta, { color: colors.muted }]}>{page} of {pages}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Next ${label}`} accessibilityState={{ disabled: page >= pages }} disabled={page >= pages} onPress={() => onChange(page + 1)} style={({ pressed }) => [styles.pageAction, { opacity: page >= pages ? .4 : pressed ? .65 : 1 }]}><Text style={[styles.actionText, { color: colors.link }]}>Next</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  content: { gap: 12 }, flex: { flex: 1, minWidth: 0 }, tools: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
  back: { flex: 1, minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center', paddingRight: 8 }, searchButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  meta: { fontSize: 14, lineHeight: 21 }, actionText: { fontSize: 14, lineHeight: 20, fontWeight: '600', flexShrink: 1 },
  details: { gap: 8 }, detailHeading: { flexDirection: 'row', gap: 12, alignItems: 'center' }, heading: { fontSize: 18, lineHeight: 25, fontWeight: '600' }, mapAction: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', borderRadius: 16 },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: 20 }, rowTitle: { fontSize: 16, lineHeight: 23, fontWeight: '500' },
  sourceAction: { minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, pageAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
});
