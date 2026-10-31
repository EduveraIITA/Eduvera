import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';
import type { CampusSceneDocument } from '../../../../packages/contracts/src/campus-scenes/types';
import { useSession } from '../../auth/SessionProvider';
import { useReducedMotion } from '../../ui/Motion';
import { campusPeopleClock, campusPeopleEpoch, compileCampusPeople, retainCampusPeople, sampleCampusPeople, type CampusPeoplePlace, type CampusPeopleRetention, type CampusPeopleSourceState } from '../../lib/campus-people';

export interface UseCampusPeopleOptions {
  schoolId: string;
  campusId: string;
  publicationKey: string;
  scene: CampusSceneDocument | null;
  places: readonly CampusPeoplePlace[];
  motion?: unknown;
  sourceScopeKey: string;
  sourceState?: CampusPeopleSourceState;
  source?: 'personal' | 'operations';
  routingAvailable?: boolean;
  excludedConnectorIds?: readonly string[];
  floorId?: string | null;
  maxPeople?: number;
}

/** The caller owns its current authorized /campus-view/ or /mine snapshot; this hook performs no requests. */
export function useCampusPeople(options: UseCampusPeopleOptions) {
  const session = useSession(), focused = useIsFocused(), reducedMotion = useReducedMotion();
  const [enabled, setEnabled] = useState(true), [active, setActive] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const change = () => { setActive(AppState.currentState === 'active'); };
    change(); const subscription = AppState.addEventListener('change', change);
    return () => subscription.remove();
  }, []);
  const membership = session.memberships.some(row => row.school_id === options.schoolId);
  const mayReadOperations = session.memberships.some(row => row.school_id === options.schoolId && row.role === 'admin' && row.access_scope !== 'assigned_work');
  const authorized = session.status === 'authenticated' && !!session.user && session.schoolId === options.schoolId && membership
    && (options.source !== 'operations' || mayReadOperations);
  const scope = { schoolId: options.schoolId, campusId: options.campusId, actorId: session.user?.id ?? '', scopeKey: session.scopeKey,
    sourceScopeKey: options.sourceScopeKey, publicationKey: options.publicationKey, source: options.source, environment: session.environment };
  const epoch = authorized ? campusPeopleEpoch(scope) : null;
  const sourceState: CampusPeopleSourceState = !authorized || !epoch ? 'unavailable' : options.sourceState ?? 'available';
  const excludedKey = JSON.stringify([...(options.excludedConnectorIds ?? [])].sort());
  const excludedConnectorIds = useMemo(() => [...(options.excludedConnectorIds ?? [])].sort(), [excludedKey]);
  const candidate = useMemo(() => compileCampusPeople({ ...scope, scene: options.scene, places: options.places, motion: options.motion, sourceState,
    routingAvailable: options.routingAvailable, excludedConnectorIds }),
  [epoch, options.scene, options.places, options.motion, sourceState, options.routingAvailable, excludedConnectorIds]);
  // This snapshot seeds the UI-runtime clock. Live frame interpolation belongs to
  // Skia/Reanimated; no React timer or scene reconciliation runs on animation frames.
  const clock = campusPeopleClock(session.environment, epoch, Date.now(), active && focused && enabled, reducedMotion);
  const [retained, setRetained] = useState<CampusPeopleRetention>(() => retainCampusPeople(null, candidate, options.scene, clock));
  let value = retained;
  if (retained.candidate !== candidate || retained.epoch !== clock.epoch || retained.instant !== clock.instant && !clock.live) {
    value = retainCampusPeople(retained, candidate, options.scene, clock); setRetained(value);
  }
  const compiled = value.value;
  const visibility = { enabled, focused, active, reducedMotion, floorId: options.floorId, maxPeople: options.maxPeople };
  const sampled = useMemo(() => sampleCampusPeople(compiled, clock, visibility),
    [compiled, clock.instant, clock.epoch, enabled, focused, active, reducedMotion, options.floorId, options.maxPeople]);
  return { data: enabled ? compiled : null, compiled, clock, visibility, enabled, setEnabled, ...sampled,
    state: sourceState === 'loading' ? 'loading' as const : compiled ? 'available' as const : 'unavailable' as const, reducedMotion };
}
