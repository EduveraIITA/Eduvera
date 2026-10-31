import type { CampusMotionProjection } from '../../../packages/contracts/src/campus-motion';
import { campusMotionMatches } from '../../../packages/contracts/src/campus-motion-validation';
import { executionEnvironmentFromWire, executionEnvironmentIdentity, type ExecutionEnvironment } from '../../../packages/contracts/src/execution-environment';
import { compileScenePeopleTracks, reconcileScenePeopleTracks, sampleScenePeople, type ScenePeopleRoutingState } from '../../../packages/contracts/src/campus-scenes/scenePeopleTracks';
import type { ScenePeopleClock, ScenePeopleCompiled, ScenePeoplePose, ScenePeoplePulsePose } from '../../../packages/contracts/src/campus-scenes/scenePeopleTracks.types';
import type { CampusSceneDocument, CampusSceneSpace } from '../../../packages/contracts/src/campus-scenes/types';
import type { Environment } from '../auth/session-types';

export type CampusPeopleSourceState = 'loading' | 'available' | 'unavailable';
export type CampusPeoplePlace = Pick<CampusSceneSpace, 'id' | 'parent_space_id' | 'kind'>;
export interface CampusPeopleScope {
  schoolId: string;
  campusId: string;
  actorId: string;
  scopeKey: string;
  /** Identity captured with the owning authorized read, never a tag added to retained foreign data. */
  sourceScopeKey: string;
  publicationKey: string;
  source?: 'personal' | 'operations';
  environment: Environment;
}

export function campusPeopleEnvironment(environment: Environment): ExecutionEnvironment | null {
  try { return executionEnvironmentFromWire(environment); } catch { return null; }
}

export function campusPeopleEpoch(scope: CampusPeopleScope): string | null {
  const environment = campusPeopleEnvironment(scope.environment);
  if (!scope.schoolId || !scope.campusId || !scope.actorId || !scope.publicationKey || !scope.scopeKey || scope.sourceScopeKey !== scope.scopeKey || !environment
    || environment.mode === 'simulation' && environment.unavailable
    || environment.institutionId && environment.institutionId !== scope.schoolId) return null;
  return JSON.stringify([scope.scopeKey, scope.actorId, scope.schoolId, scope.campusId, scope.publicationKey, scope.source ?? 'personal', executionEnvironmentIdentity(environment)]);
}

export function campusPeopleProjection(raw: unknown, scope: CampusPeopleScope): CampusMotionProjection | null {
  const environment = campusPeopleEnvironment(scope.environment);
  return campusPeopleEpoch(scope) && environment && campusMotionMatches(raw, scope.schoolId, scope.campusId, environment) ? raw : null;
}

/** Reuse the same reviewed geometry compiler as web; point events never create people. */
export function compileCampusPeople(input: CampusPeopleScope & ScenePeopleRoutingState & {
  scene: CampusSceneDocument | null;
  places: readonly CampusPeoplePlace[];
  motion: unknown;
  sourceState?: CampusPeopleSourceState;
}): ScenePeopleCompiled | null {
  const motion = input.sourceState === 'unavailable' || input.sourceState === 'loading' ? null : campusPeopleProjection(input.motion, input);
  return input.scene && motion ? compileScenePeopleTracks(input.scene, input.places, motion, input.publicationKey, {
    routingAvailable: input.routingAvailable,
    excludedConnectorIds: input.excludedConnectorIds,
  }) : null;
}

/** Simulation always samples the confirmed server clock. Native never extrapolates its world. */
export function campusPeopleClock(environment: Environment, epoch: string | null, liveInstant: number | null, active = true, reducedMotion = false): ScenePeopleClock {
  const normalized = campusPeopleEnvironment(environment);
  const instant = !epoch || !normalized || normalized.mode === 'simulation' && normalized.unavailable ? null
    : normalized.mode === 'simulation' ? Date.parse(normalized.virtualClock.now)
      : liveInstant !== null && Number.isFinite(liveInstant) ? liveInstant : null;
  return { instant: instant !== null && Number.isFinite(instant) ? instant : null, live: normalized?.mode === 'live',
    running: Boolean(epoch && active && !reducedMotion && normalized?.mode === 'live'), epoch: epoch ?? 'campus-people-unavailable' };
}

export interface CampusPeopleRetention {
  candidate: ScenePeopleCompiled | null;
  value: ScenePeopleCompiled | null;
  instant: number | null;
  epoch: string;
}

/** Same-source forward refreshes may retarget; actor/world/layout changes and backwards seeks reset. */
export function retainCampusPeople(previous: CampusPeopleRetention | null, candidate: ScenePeopleCompiled | null, scene: CampusSceneDocument | null, clock: ScenePeopleClock): CampusPeopleRetention {
  const seek = !previous || previous.epoch !== clock.epoch || clock.instant === null
    || previous.instant !== null && clock.instant < previous.instant;
  const value = seek ? candidate : previous.candidate === candidate ? previous.value
    : candidate && scene ? reconcileScenePeopleTracks(previous.value, candidate, scene, clock.instant) : null;
  return { candidate, value, instant: clock.instant, epoch: clock.epoch };
}

export interface CampusPeopleVisibility {
  enabled: boolean;
  focused: boolean;
  active: boolean;
  reducedMotion: boolean;
  floorId?: string | null;
  maxPeople?: number;
}

export function sampleCampusPeople(compiled: ScenePeopleCompiled | null, clock: ScenePeopleClock, visibility: CampusPeopleVisibility): { poses: ScenePeoplePose[]; pulses: ScenePeoplePulsePose[] } {
  if (!compiled || !visibility.enabled || !visibility.focused || !visibility.active || clock.instant === null) return { poses: [], pulses: [] };
  const requested = visibility.maxPeople ?? 128, maximum = Number.isFinite(requested) ? Math.max(0, Math.min(256, Math.floor(requested))) : 128;
  const sampled = sampleScenePeople(compiled, clock.instant, { maxPeople: maximum, floorId: visibility.floorId });
  return {
    poses: visibility.reducedMotion ? sampled.people.map(pose => ({ ...pose, phase: 0, moving: false, opacity: 1 })) : sampled.people,
    pulses: visibility.floorId === undefined ? sampled.pulses : sampled.pulses.filter(pulse => pulse.floorId === visibility.floorId),
  };
}
