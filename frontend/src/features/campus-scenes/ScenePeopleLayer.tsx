import { useLayoutEffect, useMemo, useRef } from "react";
import type { CampusSceneDocument } from "./types";
import type { SceneSize, SceneViewport, SceneViewMode } from "./sceneGeometry";
import type { SceneLighting } from "./sceneLighting";
import type { SceneSunlight } from "./sceneSunlight";
import type { ScenePeopleClock, ScenePeopleCompiled } from "./scenePeopleTracks.types";
import { prepareScenePeopleOccluders, scenePeopleOccluders } from "./scenePeopleOcclusion";
import { createScenePeopleRenderer } from "./scenePeopleRenderer";
import "./scene-people-layer.css";

export interface ScenePeopleLayerProps {
  scene: CampusSceneDocument; mode: SceneViewMode; floorId: string | null; unit: number;
  viewport: SceneViewport; size: SceneSize; lighting: SceneLighting; sunlight: SceneSunlight;
  data: ScenePeopleCompiled; clock: ScenePeopleClock;
}

/** Fixed-screen Canvas hosted beneath SVG labels; original geometry stays editable. */
export function ScenePeopleLayer(props: ScenePeopleLayerProps) {
  const canvas = useRef<HTMLCanvasElement>(null), renderer = useRef<ReturnType<typeof createScenePeopleRenderer>>(null);
  const { scene, floorId, mode, unit, data, clock } = props;
  const occluders = useMemo(() => typeof Path2D === "undefined" ? null : prepareScenePeopleOccluders(scenePeopleOccluders(scene, floorId, mode, unit)), [scene, floorId, mode, unit]);
  const canRender = occluders !== null;
  const sourceSignature = useMemo(() => JSON.stringify(data.tracks.map(track => [track.key, track.sourceKey, track.startsAt, track.endsAt])), [data]);
  useLayoutEffect(() => {
    const engine = canvas.current && canRender ? createScenePeopleRenderer(canvas.current) : null;
    renderer.current = engine;
    return () => { engine?.dispose(); renderer.current = null; };
    // A world/source epoch disposes all retained pixels, clock easing and queued work.
  }, [data.contextKey, clock.epoch, canRender]);
  useLayoutEffect(() => {
    if (occluders) renderer.current?.update({ ...props, occluders, sourceSignature });
  }, [props, occluders, sourceSignature]);
  return <canvas ref={canvas} className="scene-people-layer" data-people-layer aria-hidden="true" />;
}
