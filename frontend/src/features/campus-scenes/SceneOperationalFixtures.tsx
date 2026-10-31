import type { CampusSceneElement, CampusScenePoint } from "./types";
import { projectScenePoint, sceneBuildingFaces, sceneElementHeight, sceneElementWidth, scenePointsAttribute, type SceneViewMode } from "./sceneGeometry";
import { sceneLitColor } from "./sceneLightingPalette";
import type { SceneLighting } from "./sceneLighting";

interface FixtureProps { element: CampusSceneElement; mode: SceneViewMode; unit: number; lighting: SceneLighting }

/** Editable architectural symbols. Their decoration never asserts a physical condition. */
export function SceneOperationalFixture({ element, mode, unit, lighting }: FixtureProps) {
  const point = element.geometry.points[0];
  if (!point) return null;
  const w = sceneElementWidth(element, unit), h = sceneElementHeight(element, unit);
  const lit = (color: string) => sceneLitColor(color, lighting);
  const project = (points: CampusScenePoint[], z = 0) => scenePointsAttribute(points.map(p => projectScenePoint(p, z, mode)));
  const corners = (x: number, y: number, width: number, depth: number) => [
    { x, y }, { x: x + width, y }, { x: x + width, y: y + depth }, { x, y: y + depth },
  ];
  const body = corners(point.x - w * .5, point.y - w * .28, w, w * .56);
  const face = (a: CampusScenePoint, b: CampusScenePoint, low: number, high: number) => scenePointsAttribute([
    projectScenePoint(a, low, mode), projectScenePoint(b, low, mode), projectScenePoint(b, high, mode), projectScenePoint(a, high, mode),
  ]);
  if (element.asset_key === "water_point") {
    const plinth = corners(point.x - w * .62, point.y - w * .39, w * 1.24, w * .78);
    return <g data-operational-fixture="water_point">
      <polygon points={project(plinth)} fill={lit("#b4b8a9")} stroke={lit("#84988f")} strokeWidth={unit * .07} />
      {mode === "2.5d" ? sceneBuildingFaces(body, h * .72).map((side, i) => <polygon key={i} points={scenePointsAttribute(side.points)} fill={lit(i % 2 ? "#849d9c" : "#b5c2bb")} stroke={lit("#6f8889")} strokeWidth={unit * .04} />) : null}
      <polygon points={project(body, h * .72)} fill={lit("#dce1d5")} stroke={lit("#8c9e98")} strokeWidth={unit * .06} />
      {[.27, .73].map((fraction, i) => {
        const center = { x: point.x - w * .5 + w * fraction, y: point.y + w * .03 };
        const basin = corners(center.x - w * .17, center.y - w * .17, w * .34, w * .29);
        const tap = projectScenePoint({ x: center.x, y: center.y - w * .13 }, h * .89, mode);
        const tapBase = projectScenePoint({ x: center.x, y: center.y - w * .13 }, h * .72, mode);
        return <g key={i}>
          <polygon points={project(basin, h * .73)} fill={lit("#637f85")} stroke={lit("#e1e7df")} strokeWidth={unit * .065} />
          <polygon points={project(corners(center.x - w * .13, center.y - w * .12, w * .26, w * .19), h * .735)} fill={lit("#879e9d")} />
          <path d={`M ${tapBase.x} ${tapBase.y} L ${tap.x} ${tap.y} l ${w * .06} 0`} stroke={lit("#d3ddd5")} strokeWidth={unit * .08} strokeLinecap="round" fill="none" />
        </g>;
      })}
      {mode === "2.5d" ? <polygon points={face(body[3]!, body[2]!, h * .12, h * .56)} fill={lit("#809c9d")} stroke={lit("#b5c7bd")} strokeWidth={unit * .045} /> : null}
    </g>;
  }
  return <g data-operational-fixture="equipment">
    <polygon points={project(corners(point.x - w * .58, point.y - w * .35, w * 1.16, w * .7))} fill={lit("#a6afa3")} stroke={lit("#7b9188")} strokeWidth={unit * .06} />
    {mode === "2.5d" ? sceneBuildingFaces(body, h).map((side, i) => <polygon key={i} points={scenePointsAttribute(side.points)} fill={lit(i % 2 ? "#6e8a8b" : "#9cb3ad")} stroke={lit("#59777d")} strokeWidth={unit * .05} />) : null}
    <polygon points={project(body, h)} fill={lit("#bdcbc3")} stroke={lit("#7e9a96")} strokeWidth={unit * .07} />
    {mode === "2.5d" ? <>
      <polygon points={face(body[3]!, body[2]!, h * .08, h * .88)} fill={lit("#789691")} stroke={lit("#d0d9ce")} strokeWidth={unit * .055} />
      {Array.from({ length: 5 }, (_, i) => <polyline key={i} points={face(
        { x: point.x - w * .36, y: point.y + w * .28 }, { x: point.x + w * .18, y: point.y + w * .28 },
        h * (.24 + i * .105), h * (.24 + i * .105),
      )} fill="none" stroke={lit("#4f7477")} strokeWidth={unit * .05} />)}
      <polygon points={face({ x: point.x + w * .3, y: point.y + w * .28 }, { x: point.x + w * .34, y: point.y + w * .28 }, h * .4, h * .57)} fill={lit("#d7dbc8")} />
    </> : <polyline points={project([{ x: point.x, y: point.y - w * .22 }, { x: point.x, y: point.y + w * .22 }])} stroke={lit("#6d8a87")} strokeWidth={unit * .07} />}
  </g>;
}

export function SceneNavigationFixture({ element, mode, unit, lighting }: FixtureProps) {
  const point = element.geometry.points[0], connector = element.navigation_connector;
  if (!point || !connector) return null;
  const width = sceneElementWidth(element, unit), w = width * .5;
  const lit = (color: string) => sceneLitColor(color, lighting);
  const points = (values: CampusScenePoint[]) => scenePointsAttribute(values.map(p => projectScenePoint(p, 0, mode)));
  const left = point.x - w, top = point.y - w;
  const outline = [{ x: left, y: top }, { x: left + width, y: top }, { x: left + width, y: top + width }, { x: left, y: top + width }];
  return <g data-navigation-fixture={connector.kind}>
    <polygon points={points(outline)} fill={lit("#e4dfcf")} stroke={lit("#718a85")} strokeWidth={unit * .1} />
    {connector.kind === "stairs" ? <>
      {Array.from({ length: 6 }, (_, index) => <polyline key={index} points={points([
        { x: left + width * .16, y: top + width * (.17 + index * .125) }, { x: left + width * .84, y: top + width * (.17 + index * .125) },
      ])} stroke={lit("#6c8885")} strokeWidth={unit * .08} />)}
      <polyline points={points([{ x: point.x, y: top + width * .78 }, { x: point.x, y: top + width * .25 }, { x: point.x - width * .1, y: top + width * .36 }])} stroke={lit("#3d636b")} strokeWidth={unit * .11} fill="none" />
    </> : connector.kind === "lift" ? <>
      <polygon points={points([{ x: left + width * .2, y: top + width * .17 }, { x: left + width * .8, y: top + width * .17 }, { x: left + width * .8, y: top + width * .82 }, { x: left + width * .2, y: top + width * .82 }])} fill={lit("#9bb3b0")} stroke={lit("#5a7c80")} strokeWidth={unit * .08} />
      <polyline points={points([{ x: point.x, y: top + width * .19 }, { x: point.x, y: top + width * .8 }])} stroke={lit("#d8e0d6")} strokeWidth={unit * .08} />
      <polygon points={points([{ x: point.x - width * .15, y: top + width * .08 }, { x: point.x - width * .22, y: top + width * .16 }, { x: point.x - width * .08, y: top + width * .16 }])} fill={lit("#436d76")} />
    </> : <>
      <polyline points={points([{ x: left + width * .18, y: top + width * .8 }, { x: left + width * .18, y: top + width * .2 }, { x: left + width * .82, y: top + width * .2 }, { x: left + width * .82, y: top + width * .8 }])} stroke={lit("#78958d")} strokeWidth={unit * .2} fill="none" />
      <polyline points={points([{ x: point.x, y: top + width * .85 }, { x: point.x, y: top + width * .43 }, { x: point.x - width * .12, y: top + width * .57 }])} stroke={lit("#3d6870")} strokeWidth={unit * .1} fill="none" />
    </>}
  </g>;
}
