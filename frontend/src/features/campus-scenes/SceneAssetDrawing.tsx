import { memo, useId } from "react";
import type { CampusSceneElement, CampusScenePoint } from "./types";
import { sceneMaterial } from "./sceneAssets";
import { scenePlantSilhouette } from "./scenePlantSilhouettes";
import { SceneNavigationFixture, SceneOperationalFixture } from "./SceneOperationalFixtures";
import { SceneIndoorFixture } from './SceneIndoorFixture';
import { isSceneIndoorAssetKey, sceneIndoorFootprint } from './sceneIndoorAssets';
import { SceneRoomFloor } from './SceneRoomFloor';
import type { SceneLighting } from "./sceneLighting";
import { sceneLitColor } from "./sceneLightingPalette";
import { DEFAULT_SCENE_SUNLIGHT, sceneShadowOffset, type SceneSunlight } from "./sceneSunlight";
import { SCENE_PLANE_TRANSFORM, scenePointDepth, projectScenePoint, scenePresentationHeight, sceneProjectedHeight, sceneBuildingFaces, sceneElementHeight, sceneElementWidth, scenePointBounds, scenePointsAttribute, sceneRoofFaces, signedSceneArea, type SceneFace, type SceneViewMode } from "./sceneGeometry";

const plainPoints = scenePointsAttribute;

function blendColor(shade: string, light: string, amount: number) {
  const channel = (color: string, index: number) => parseInt(color.slice(index,index+2),16);
  return `#${[1,3,5].map(index => Math.round(channel(shade,index)*(1-amount)+channel(light,index)*amount).toString(16).padStart(2,"0")).join("")}`;
}

function facadeColor(face: SceneFace, shade: string, light: string, sunlight: SceneSunlight, lighting: SceneLighting) {
  const dot = -face.normal.x * sunlight.direction.x - face.normal.y * sunlight.direction.y;
  const direct = Math.max(0,dot) * Math.cos(sunlight.altitude) * sunlight.strength;
  return blendColor(shade,light,lighting === "night" ? .4 : .3 + .7 * direct);
}

function projected(points: readonly CampusScenePoint[], height: number, mode: SceneViewMode) {
  return plainPoints(points.map((point) => projectScenePoint(point, height, mode)));
}

function interpolate(a: CampusScenePoint, b: CampusScenePoint, fraction: number): CampusScenePoint {
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
}

function planeQuad(a: CampusScenePoint, b: CampusScenePoint, bottom: number, top: number) {
  return plainPoints([projectScenePoint(a, bottom), projectScenePoint(b, bottom), projectScenePoint(b, top), projectScenePoint(a, top)]);
}

function BuildingDrawing({ element, mode, unit, simple, lighting, sunlight }: { element: CampusSceneElement; mode: SceneViewMode; unit: number; simple: boolean; lighting: SceneLighting; sunlight: SceneSunlight }) {
  const points = element.geometry.points, height = sceneElementHeight(element, unit), originalMaterial = sceneMaterial(element);
  const lit = (color: string) => sceneLitColor(color, lighting);
  const material = { ...originalMaterial };
  for (const key of Object.keys(material) as Array<keyof typeof material>) material[key] = lit(material[key]);
  const clipId = `roof-${useId().replace(/:/g, "")}`, bounds = scenePointBounds(points);
  if (mode === '2d' && element.kind === 'room') return <SceneRoomFloor element={element} unit={unit} lighting={lighting}/>;
  if (mode === "2d") return <>
    <polygon points={plainPoints(points)} fill={element.kind === "room" ? lit("#f4f0e4") : material.roof} stroke={material.shade} strokeWidth={unit * .35} />
    <polygon points={plainPoints(points)} fill="none" stroke={material.edge} strokeWidth={unit * .6} strokeLinejoin="round" />
  </>;
  const faces = sceneBuildingFaces(points, height), levels = Math.max(1, element.levels ?? Math.round(height / (3.6 * unit)));
  const roofFaces = sceneRoofFaces(points, height, element.roof, unit);
  const flatRoof = roofFaces.length === 1;
  const glazed = element.asset_key === "library" || element.asset_key === "laboratory" || element.material === "glass";
  const hall = element.asset_key === "auditorium";
  const windowVariation = element.id.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const accent = lit(element.asset_key === "academic" ? "#527d7e" : element.asset_key === "library" ? "#3e707c" : element.asset_key === "dining" ? "#89633e" : originalMaterial.shade);
  const faceLength = (index: number) => { const face = faces[index]; return face ? Math.hypot(face.edge[1].x - face.edge[0].x, face.edge[1].y - face.edge[0].y) : 0; };
  const entryFace = faces.reduce((best, _, index) => faceLength(index) > faceLength(best) ? index : best, 0);
  return <>
    <defs><linearGradient id={`${clipId}-glass`} x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stopColor={lighting === "night" ? "#f2cf85" : "#9dc6cb"} /><stop offset=".48" stopColor={lighting === "night" ? "#dba75c" : material.glass} /><stop offset="1" stopColor={lighting === "night" ? "#9f7947" : "#274a57"} /></linearGradient></defs>
    {faces.map((face, faceIndex) => {
      const [a, b] = face.edge, length = Math.hypot(b.x - a.x, b.y - a.y);
      const columns = Math.max(1, Math.min(simple ? 5 : 20, Math.floor(length / ((hall ? 7 : glazed ? 5.2 : element.asset_key === "residence" ? 3.2 : 3.7) * unit))));
      const rows = Math.min(simple ? 3 : 12, hall ? 1 : levels), rowHeight = height / rows;
      return <g key={faceIndex}>
        <polygon data-building-facade points={plainPoints(face.points)} fill={facadeColor(face,material.shade,material.light,sunlight,lighting)} stroke={material.shade} strokeWidth={unit * .12} strokeLinejoin="round" />
        {element.material === "brick" && !simple && Array.from({ length: Math.min(36, levels * 5) }, (_, index) => <polyline key={`course-${index}`} points={plainPoints([projectScenePoint(a, (index + 1) * height / (levels * 5)), projectScenePoint(b, (index + 1) * height / (levels * 5))])} stroke={lit("#ddb190")} opacity={.22} strokeWidth={unit * .1} />)}
        {Array.from({ length: rows }, (_, row) => {
          const bottom = row * rowHeight + rowHeight * (glazed ? .14 : .22), top = bottom + rowHeight * (glazed ? .72 : hall ? .63 : .55);
          return <g key={row}>
            <polygon points={planeQuad(a, b, row * rowHeight, row * rowHeight + unit * .23)} fill={accent} opacity={.78} />
            <polyline points={plainPoints([projectScenePoint(a, row * rowHeight + unit * .28), projectScenePoint(b, row * rowHeight + unit * .28)])} stroke={material.edge} strokeWidth={unit * .16} opacity={.85} />
            {Array.from({ length: columns }, (_, column) => {
              const inset = glazed ? .08 : element.asset_key === "residence" ? .26 : .18;
              const start = (column + inset) / columns, end = (column + 1 - inset) / columns;
              const first = interpolate(a, b, start), last = interpolate(a, b, end);
              return <g key={column}>
                <polygon points={planeQuad(first, last, bottom - unit * .12, top + unit * .12)} fill={face.light ? material.shade : lit("#456261")} />
                <polygon data-illustrative-window={lighting} points={planeQuad(first, last, bottom, top)} fill={lighting === "night" && (windowVariation + faceIndex * 3 + row * 5 + column) % 7 < 2 ? lit("#24414e") : `url(#${clipId}-glass)`} stroke={material.mullion} strokeWidth={unit * .16} />
                {!simple && <>
                  <polyline points={plainPoints([projectScenePoint(interpolate(first, last, .5), bottom), projectScenePoint(interpolate(first, last, .5), top)])} stroke={material.mullion} strokeWidth={unit * .12} />
                  <polyline points={plainPoints([projectScenePoint(first, bottom + (top - bottom) * .62), projectScenePoint(last, bottom + (top - bottom) * .62)])} stroke={material.mullion} strokeWidth={unit * .1} opacity={.8} />
                  <polyline points={plainPoints([projectScenePoint(first, bottom - unit * .13), projectScenePoint(last, bottom - unit * .13)])} stroke={material.edge} strokeWidth={unit * .3} />
                </>}
              </g>;
            })}
          </g>;
        })}
        <polygon points={planeQuad(a, b, 0, Math.min(unit * .55, height * .08))} fill={material.shade} opacity={.65} />
        <polygon points={planeQuad(a, b, height - unit * .65, height)} fill={accent} />
        <polyline points={plainPoints([projectScenePoint(a, height), projectScenePoint(b, height)])} stroke={material.edge} strokeWidth={unit * .25} />
        {faceIndex === entryFace && length > unit * 8 && (() => {
          const doorWidth = Math.min(unit * (glazed ? 5 : 4), length * .26), doorHeight = Math.min(unit * 2.8, height * .8);
          const first = interpolate(a, b, .5 - doorWidth / length / 2), last = interpolate(a, b, .5 + doorWidth / length / 2);
          const winding = signedSceneArea(points) >= 0 ? 1 : -1;
          const offset = { x: (b.y - a.y) / length * unit * 1.3 * winding, y: -(b.x - a.x) / length * unit * 1.3 * winding };
          const frontFirst = { x: first.x + offset.x, y: first.y + offset.y }, frontLast = { x: last.x + offset.x, y: last.y + offset.y };
          const canopy = [first, last, frontLast, frontFirst];
          return <g data-facade-entrance>
            <polygon points={planeQuad(interpolate(a,b,.5-(doorWidth+unit*.9)/length/2),interpolate(a,b,.5+(doorWidth+unit*.9)/length/2),0,doorHeight+unit*.35)} fill={material.edge} />
            <polygon points={planeQuad(first, last, 0, doorHeight)} fill={lighting === "night" ? "#c09b64" : "#284d57"} stroke={material.edge} strokeWidth={unit * .18} />
            <polygon points={planeQuad(first,last,doorHeight*.7,doorHeight)} fill={lighting === "night" ? "#d5b37e" : "#7aa9b3"} />
            <polyline points={plainPoints([projectScenePoint(interpolate(first, last, .5), 0), projectScenePoint(interpolate(first, last, .5), doorHeight)])} stroke={material.mullion} strokeWidth={unit * .12} />
            {!simple && <>
              {[.4,.6].map(position=><polyline key={position} points={plainPoints([projectScenePoint(interpolate(first,last,position),doorHeight*.33),projectScenePoint(interpolate(first,last,position),doorHeight*.48)])} stroke={lit("#d4d2b7")} strokeWidth={unit*.1}/>)}
              <polygon points={projected([frontFirst,frontLast,{x:frontLast.x+offset.x*.45,y:frontLast.y+offset.y*.45},{x:frontFirst.x+offset.x*.45,y:frontFirst.y+offset.y*.45}],0,mode)} fill={lit("#c5c3ae")} stroke={lit("#eeead8")} strokeWidth={unit*.16}/>
              {[frontFirst,frontLast].map((point,index)=><polyline key={index} points={plainPoints([projectScenePoint(point),projectScenePoint(point,doorHeight+unit*.18)])} stroke={material.edge} strokeWidth={unit*.2}/>)}
            </>}
            <polygon points={planeQuad(frontFirst,frontLast,doorHeight,doorHeight+unit*.18)} fill={material.shade}/>
            <polygon points={projected(canopy, doorHeight + unit * .18, mode)} fill={accent} stroke={material.edge} strokeWidth={unit * .16} />
            <polyline points={projected([first, last], 0, mode)} stroke={lit("#e4dcc7")} strokeWidth={unit * .55} />
          </g>;
        })()}
      </g>;
    })}
    {roofFaces.map((face, index) => <polygon key={index} points={plainPoints(face)} fill={flatRoof ? material.roof : lit(["#7b8a85", "#536d6d", "#a1aaa0", "#6d8179"][index % 4]!)} stroke={flatRoof ? material.edge : lit("#aebeb0")} strokeWidth={unit * .23} strokeLinejoin="round" />)}
    {flatRoof && <>
      <defs><clipPath id={clipId}><polygon points={projected(points, height, mode)} /></clipPath></defs>
      <g clipPath={`url(#${clipId})`}>
        {Array.from({ length: Math.min(18, Math.ceil(bounds.height / (7 * unit))) }, (_, index) => {
          const y = bounds.y + index * 7 * unit;
          return <polyline key={index} points={projected([{ x: bounds.x, y }, { x: bounds.x + bounds.width, y }], height, mode)} stroke={lit("#6f8986")} strokeWidth={unit * .17} opacity={.45} />;
        })}
        <polygon points={projected(points.map((point) => ({ x: point.x + unit * .7, y: point.y + unit * .7 })), height, mode)} fill="none" stroke={lit("#718783")} strokeWidth={unit * .55} />
      </g>
      <polygon points={projected(points, height, mode)} fill="none" stroke={material.edge} strokeWidth={unit * .7} strokeLinejoin="round" />
    </>}
  </>;
}

/** Nets and posts belong to the editable sports-ground illustration, not a resource claim. */
function SportsGoals({x,y,w,h,unit,lighting}:{x:number;y:number;w:number;h:number;unit:number;lighting:SceneLighting}) {
  const vertical = h >= w, span = Math.min(7.32*unit,(vertical ? w : h)*.27), goalHeight = Math.min(2.44*unit,span*.38), depth = Math.min(2*unit,span*.3);
  if (span < unit*1.5) return null;
  const line = sceneLitColor("#eef0df",lighting), mesh = sceneLitColor("#dce1ce",lighting);
  return <g data-sports-goals fill="none" strokeLinecap="round" strokeLinejoin="round">
    {[0,1].map(end=>{
      const center = vertical ? {x:x+w*.5,y:y+h*(end ? .9 : .1)} : {x:x+w*(end ? .9 : .1),y:y+h*.5};
      const a = vertical ? {x:center.x-span/2,y:center.y} : {x:center.x,y:center.y-span/2};
      const b = vertical ? {x:center.x+span/2,y:center.y} : {x:center.x,y:center.y+span/2};
      const behind = {x:vertical ? 0 : depth*(end ? 1 : -1),y:vertical ? depth*(end ? 1 : -1) : 0};
      const c={x:a.x+behind.x,y:a.y+behind.y},d={x:b.x+behind.x,y:b.y+behind.y};
      return <g key={end} data-sports-goal={end ? "near" : "far"}>
        <polygon points={planeQuad(c,d,0,goalHeight*.8)} fill={mesh} fillOpacity={.13} stroke={mesh} strokeWidth={unit*.12}/>
        {[.2,.4,.6,.8].map(position=><polyline key={position} points={plainPoints([projectScenePoint(interpolate(c,d,position)),projectScenePoint(interpolate(c,d,position),goalHeight*.8),projectScenePoint(interpolate(a,b,position),goalHeight)])} stroke={mesh} strokeWidth={unit*.065} opacity={.8}/>)}
        {[.25,.5,.75].map(position=><polyline key={position} points={plainPoints([projectScenePoint(c,goalHeight*.8*position),projectScenePoint(d,goalHeight*.8*position)])} stroke={mesh} strokeWidth={unit*.065} opacity={.8}/>)}
        <polyline points={plainPoints([projectScenePoint(a),projectScenePoint(a,goalHeight),projectScenePoint(b,goalHeight),projectScenePoint(b)])} stroke={line} strokeWidth={unit*.25}/>
        {[a,b].map((point,index)=><polyline key={index} points={plainPoints([projectScenePoint(point,goalHeight),projectScenePoint(index ? d : c,goalHeight*.8),projectScenePoint(index ? d : c)])} stroke={line} strokeWidth={unit*.16}/>)}
      </g>;
    })}
  </g>;
}

function SurfaceDrawing({ element, mode, unit, lighting }: { element: CampusSceneElement; mode: SceneViewMode; unit: number; lighting: SceneLighting }) {
  const lit = (color: string) => sceneLitColor(color, lighting);
  const bounds = scenePointBounds(element.geometry.points), clipId = `surface-${useId().replace(/:/g, "")}`;
  const key = element.asset_key ?? element.material;
  const water = key === "water" || element.material === "water", parking = key === "parking";
  const sports = key === "sports", flowers = key === "flower_bed";
  const paved = element.material === "paving" || key === "paving", sand = element.material === "sand";
  const grass = element.material === "grass" || key === "grass" || sports;
  const fill = flowers ? "#786f4d" : water ? "#548f97" : parking ? "#7e8e8b" : paved ? "#d7cdb6" : sand ? "#c9ab76" : grass ? "#84a65e" : "#bec7b3";
  const x = bounds.x, y = bounds.y, w = bounds.width, h = bounds.height;
  const verticalPitch = h >= w;
  return <>
  <g transform={mode === "2.5d" ? SCENE_PLANE_TRANSFORM : undefined}>
    <defs><clipPath id={clipId}><polygon points={plainPoints(element.geometry.points)} /></clipPath></defs>
    <polygon points={plainPoints(element.geometry.points)} fill={lit(fill)} stroke={lit(water ? "#b7c69d" : paved ? "#b3b598" : "#668c54")} strokeWidth={unit * .7} />
    <g clipPath={`url(#${clipId})`}>
      {water ? <>
        <polygon points={plainPoints(element.geometry.points)} fill="none" stroke={lit("#a9bd8a")} strokeWidth={unit * 2.3} />
        <polygon points={plainPoints(element.geometry.points)} fill="none" stroke={lit("#71b2ad")} strokeWidth={unit * 6} opacity={.45} />
        {Array.from({ length: 5 }, (_, index) => {
          const start=x+w*(.2+(index%3)*.11),lineY=y+h*(.24+index*.12),length=w*(index%2 ? .21 : .3);
          return <path key={index} d={`M ${start} ${lineY} q ${length*.23} ${h*.035} ${length*.5} 0 t ${length*.5} 0`} fill="none" stroke={lit("#b2cdc0")} opacity={.4} strokeWidth={unit * .2} strokeLinecap="round"/>;
        })}
      </> : null}
      {flowers && <>
        <polygon points={plainPoints(element.geometry.points)} fill="none" stroke={lit("#a0ad77")} strokeWidth={unit * 1.8} />
        {Array.from({ length: Math.min(48, Math.max(6, Math.floor(w * h / (unit * unit * 10)))) }, (_, index) => {
          const columns = Math.max(2, Math.ceil(w / (3 * unit))), row = Math.floor(index / columns), column = index % columns;
          const px = x + (column + .5 + (row % 2) * .24) * w / columns, py = y + (row + .7) * 2.6 * unit;
          return <g key={index}><ellipse cx={px} cy={py} rx={unit * 1.15} ry={unit * .85} fill={lit(index % 2 ? "#5d7949" : "#75844b")} />
            {[[-.42, -.18], [.28, .1], [0, -.5]].map(([dx = 0, dy = 0], flower) => <circle key={flower} cx={px + dx * unit} cy={py + dy * unit} r={unit * .23} fill={lit(index % 3 === 0 ? "#d6b57a" : index % 3 === 1 ? "#b58691" : "#d6d0aa")} />)}</g>;
        })}
      </>}
      {grass && Array.from({ length: 10 }, (_, index) => <rect key={index} x={x + (sports && verticalPitch ? 0 : w*index/10)} y={y + (sports && verticalPitch ? h*index/10 : 0)} width={sports && verticalPitch ? w : w/20} height={sports && verticalPitch ? h/20 : h} fill={lit("#c5d69a")} opacity={.22} />)}
      {sports ? <g fill="none" stroke={lit("#edf0d7")} strokeWidth={unit * .35} opacity={.93}>
        <rect x={x + w * .1} y={y + h * .1} width={w * .8} height={h * .8} />
        <path d={verticalPitch ? `M ${x+w*.1} ${y+h*.5} H ${x+w*.9}` : `M ${x+w*.5} ${y+h*.1} V ${y+h*.9}`} />
        <circle cx={x + w * .5} cy={y + h * .5} r={Math.min(w,h)*.13} />
        <circle cx={x + w * .5} cy={y + h * .5} r={unit*.24} fill={lit("#edf0d7")}/>
        {[0,1].map(end=><g key={end}>
          <rect x={x+w*(verticalPitch ? .3 : end ? .77 : .1)} y={y+h*(verticalPitch ? end ? .77 : .1 : .3)} width={w*(verticalPitch ? .4 : .13)} height={h*(verticalPitch ? .13 : .4)}/>
          <rect x={x+w*(verticalPitch ? .4 : end ? .845 : .1)} y={y+h*(verticalPitch ? end ? .845 : .1 : .4)} width={w*(verticalPitch ? .2 : .055)} height={h*(verticalPitch ? .055 : .2)}/>
        </g>)}
      </g> : null}
      {parking ? <g fill="none" stroke={lit("#d5d6c6")} strokeWidth={unit * .25}>
        {Array.from({ length: Math.min(32, Math.floor(w / (3 * unit))) }, (_, index) => <path key={index} d={`M ${x + 3 * unit * index} ${y + h * .08} v ${h * .25} m 0 ${h * .34} v ${h * .25}`} />)}
        <path d={`M ${x} ${y + h * .33} H ${x + w} M ${x} ${y + h * .67} H ${x + w}`} />
      </g> : null}
      {paved ? <g stroke={lit("#b9bdad")} strokeWidth={unit * .15} opacity={.6}>
        {Array.from({ length: Math.min(35, Math.ceil(w / (5 * unit))) }, (_, index) => <path key={index} d={`M ${x + index * 5 * unit} ${y} v ${h}`} />)}
        {Array.from({ length: Math.min(35, Math.ceil(h / (5 * unit))) }, (_, index) => <path key={index} d={`M ${x} ${y + index * 5 * unit} h ${w}`} />)}
      </g> : null}
    </g>
  </g>
  {sports && mode === "2.5d" && <SportsGoals x={x} y={y} w={w} h={h} unit={unit} lighting={lighting}/>}
  </>;
}

function BoundaryDrawing({ element, mode, unit, lighting, simple, sunlight }: { element: CampusSceneElement; mode: SceneViewMode; unit: number; lighting: SceneLighting; simple: boolean; sunlight: SceneSunlight }) {
  const lit = (color: string) => sceneLitColor(color, lighting);
  const width = sceneElementWidth(element, unit), height = sceneElementHeight(element, unit);
  const material = sceneMaterial(element);
  const wallLight = element.material === "brick" ? material.light : "#b9b8a6", wallShade = element.material === "brick" ? material.shade : "#92998a", cap = element.material === "brick" ? "#b29c86" : "#c2c3b2";
  if (mode === "2d") return <polyline data-boundary-wall points={plainPoints(element.geometry.points)} fill="none" stroke={lit(material.shade)} strokeWidth={width} strokeLinejoin="round" />;
  const segments = element.geometry.points.slice(1).map((b, index) => ({ a: element.geometry.points[index]!, b })).sort((first, second) => Math.max(scenePointDepth(first.a), scenePointDepth(first.b)) - Math.max(scenePointDepth(second.a), scenePointDepth(second.b)));
  const masonry = (points: CampusScenePoint[], elevation: number) => <>
    {sceneBuildingFaces(points, elevation).map((face, index) => <polygon key={index} points={plainPoints(face.points)} fill={facadeColor(face,lit(wallShade),lit(wallLight),sunlight,lighting)} stroke={lit(wallShade)} strokeWidth={unit * .06} />)}
    <polygon points={projected(points, elevation, mode)} fill={lit(cap)} stroke={lit(wallShade)} strokeWidth={unit * .08} />
  </>;
  return <g data-boundary-wall>{segments.map(({ a, b }, index) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < .001) return null;
    const offset = { x: (b.y - a.y) / length * width / 2, y: -(b.x - a.x) / length * width / 2 };
    const footprint = [{ x: a.x + offset.x, y: a.y + offset.y }, { x: b.x + offset.x, y: b.y + offset.y }, { x: b.x - offset.x, y: b.y - offset.y }, { x: a.x - offset.x, y: a.y - offset.y }];
    const posts = Math.min(simple ? 8 : 32, Math.max(1, Math.ceil(length / (24 * unit))));
    return <g key={index}>
      {masonry(footprint, height)}
      {!simple && <polyline points={projected([a, b], height * .45, mode)} fill="none" stroke={lit(material.roof)} strokeWidth={unit * .1} opacity={.4} />}
      {Array.from({ length: posts + 1 }, (_, post) => {
        const point = interpolate(a, b, post / posts), radius = width * .7;
        return <g key={post}>{masonry([{ x: point.x - radius, y: point.y - radius }, { x: point.x + radius, y: point.y - radius }, { x: point.x + radius, y: point.y + radius }, { x: point.x - radius, y: point.y + radius }], height + unit * .25)}</g>;
      })}
    </g>;
  })}</g>;
}

function PathDrawing({ element, mode, unit, lighting }: { element: CampusSceneElement; mode: SceneViewMode; unit: number; lighting: SceneLighting }) {
  const lit = (color: string) => sceneLitColor(color, lighting);
  const width = sceneElementWidth(element, unit), road = element.kind === "road";
  return <g transform={mode === "2.5d" ? SCENE_PLANE_TRANSFORM : undefined} fill="none" strokeLinejoin="round" strokeLinecap="round">
    <polyline points={plainPoints(element.geometry.points)} stroke={lit(road ? "#d4d4bc" : "#98a681")} strokeWidth={width + unit * 1.2} />
    <polyline points={plainPoints(element.geometry.points)} stroke={lit(road ? "#738481" : "#e1d4b8")} strokeWidth={width} />
    {road && <polyline points={plainPoints(element.geometry.points)} stroke={lit("#b7c3b5")} strokeWidth={Math.max(.2, width - unit * .7)} opacity={.12} />}
    {road && <polyline points={plainPoints(element.geometry.points)} stroke={lit("#e4dfc6")} strokeWidth={unit * .18} strokeDasharray={`${unit * 3} ${unit * 4}`} />}
    {!road && <polyline points={plainPoints(element.geometry.points)} stroke={lit("#f1eddf")} strokeWidth={unit * .18} opacity={.65} />}
  </g>;
}

function TreeDrawing({ element, mode, unit, simple, lighting }: { element: CampusSceneElement; mode: SceneViewMode; unit: number; simple: boolean; lighting: SceneLighting }) {
  const lit = (color: string) => sceneLitColor(color, lighting);
  const foliageId = `foliage-${useId().replace(/:/g, "")}`;
  const silhouette = scenePlantSilhouette(element, mode, unit);
  if (!silhouette) return null;
  const { width, projectedHeight, ground, crown, seed, palmFronds, coniferPlan, coniferTiers, columnar, shrub, cx, cy, scaleX, scaleY, organicPath: shape } = silhouette;
  const palm = element.asset_key === "tree_palm";
  const leaf = seed % 3 === 0 ? "#4c744b" : seed % 3 === 1 ? "#618047" : "#547b4a";
  if (palm) return <g>
    {mode === "2.5d" && <path d={`M ${ground.x} ${ground.y} Q ${ground.x - width * .07} ${ground.y - projectedHeight * .5} ${crown.x} ${crown.y}`} stroke={lit("#8b8461")} strokeWidth={width * .055} fill="none" />}
    {palmFronds.map((path, index) => <path key={index} d={path} fill={lit(index % 2 ? "#486e48" : "#739052")} stroke={lit("#496e47")} strokeWidth={width * .009} />)}
    <circle cx={crown.x} cy={crown.y} r={width * .055} fill={lit("#9d9e61")} />
  </g>;
  if (element.asset_key === "tree_conifer") {
    if (mode === "2d") return <polygon data-tree-silhouette="conifer" points={plainPoints(coniferPlan)} fill={lit("#3e6850")} stroke={lit("#5c7c55")} strokeWidth={unit * .15} />;
    return <g data-tree-silhouette="conifer">
      <path d={`M ${ground.x} ${ground.y} v ${-projectedHeight * .35}`} stroke={lit("#776d52")} strokeWidth={width * .065} />
      {coniferTiers.map((path, index) => <path key={index} d={path} fill={lit(index === 0 ? "#335c48" : index === 1 ? "#426b4f" : "#527753")} />)}
      {!simple && <path d={`M ${ground.x} ${ground.y - projectedHeight} Q ${ground.x - width * .08} ${ground.y - projectedHeight * .6} ${ground.x - width * .21} ${ground.y - projectedHeight * .2}`} fill="none" stroke={lit("#809468")} strokeWidth={width * .08} opacity={.3} />}
    </g>;
  }
  return <g data-tree-silhouette={shrub ? "shrub" : columnar ? "columnar" : `broadleaf-${seed % 3}`}>
    {mode === "2.5d" && !shrub && <>
      <path d={`M ${ground.x} ${ground.y} L ${cx} ${cy + projectedHeight * .12}`} stroke={lit("#82745a")} strokeWidth={width * (columnar ? .065 : .075)} />
      {!simple && <path d={`M ${ground.x} ${ground.y - projectedHeight * .35} l ${-width * .16} ${-projectedHeight * .16} M ${ground.x} ${ground.y - projectedHeight * .4} l ${width * .14} ${-projectedHeight * .13}`} stroke={lit("#82745a")} strokeWidth={width * .025} />}
    </>}
    <defs><linearGradient id={foliageId} x1="0" y1="0" x2=".85" y2="1"><stop offset="0" stopColor={lit(shrub ? "#87935e" : "#84995e")} /><stop offset=".45" stopColor={lit(shrub ? "#667d4f" : leaf)} /><stop offset="1" stopColor={lit("#35583f")} /></linearGradient></defs>
    <g transform={`translate(${cx} ${cy}) scale(${scaleX} ${scaleY})`}>
      <path d={shape} fill={simple ? lit(leaf) : `url(#${foliageId})`} />
      {!simple && <>
        <path d="M -.43 .16 Q -.2 .35 .02 .27 Q .26 .35 .43 .13 Q .34 .43 .09 .35 Q -.2 .43 -.43 .16" fill={lit("#35543e")} opacity={.2} />
        <path d="M -.29 -.22 Q -.1 -.4 .12 -.27 M -.37 -.01 Q -.2 -.13 -.07 -.07" fill="none" stroke={lit("#b1bc83")} strokeWidth={.035} strokeLinecap="round" opacity={.2} />
      </>}
    </g>
  </g>;
}

function FixtureDrawing({ element, mode, unit, lighting, sunlight, unavailable }: { element: CampusSceneElement; mode: SceneViewMode; unit: number; lighting: SceneLighting; sunlight: SceneSunlight; unavailable:boolean }) {
  const lit = (color: string) => sceneLitColor(color, lighting);
  const glowId = `lamp-${useId().replace(/:/g, "")}`;
  const p = element.geometry.points[0];
  if (!p) return null;
  const width = sceneElementWidth(element, unit), height = sceneElementHeight(element, unit);
  const ground = projectScenePoint(p, 0, mode), top = projectScenePoint(p, height, mode);
  if (element.asset_key === "lamp") return <>
    {lighting === "night" && !unavailable && <g data-illustrative-lamp-glow pointerEvents="none">
      <defs><radialGradient id={glowId}><stop offset="0" stopColor="#ffe4a5" stopOpacity=".68" /><stop offset=".3" stopColor="#f4c378" stopOpacity=".3" /><stop offset="1" stopColor="#edb95e" stopOpacity="0" /></radialGradient></defs>
      <ellipse cx={ground.x + width * .8} cy={ground.y} rx={width * 4} ry={width * 2} fill={`url(#${glowId})`} />
      <circle cx={top.x + width * .8} cy={top.y} r={width * 2.3} fill={`url(#${glowId})`} />
    </g>}
    <ellipse cx={ground.x} cy={ground.y} rx={width*.27} ry={width*.16} fill={lit("#bbc0a8")} stroke={lit("#8b9888")} strokeWidth={unit*.1}/>
    <path d={`M ${ground.x} ${ground.y} L ${top.x} ${top.y}`} stroke={lit("#526b68")} strokeWidth={unit * .26} />
    {mode === "2.5d" && <>
      <path d={`M ${ground.x-unit*.07} ${ground.y-unit*.25} L ${top.x-unit*.07} ${top.y+unit*.2}`} stroke={lit("#a5b1a4")} strokeWidth={unit*.065}/>
      <path d={`M ${ground.x} ${ground.y} v ${-sceneProjectedHeight(height*.12)}`} stroke={lit("#526963")} strokeWidth={unit*.4}/>
    </>}
    <path d={`M ${top.x} ${top.y} q ${width * .5} ${-width * .3} ${width * .8} 0`} stroke={lit("#7e8981")} strokeWidth={unit * .25} fill="none" />
    <ellipse data-lamp-bulb={unavailable ? "unavailable" : "illustrative"} cx={top.x + width * .8} cy={top.y} rx={width * .3} ry={width * .12} fill={lighting === "night" ? unavailable ? lit("#526365") : "#fff1ba" : "#e9e5cc"} stroke={lit("#8d988b")} strokeWidth={unit * .12} />
    <path d={`M ${top.x+width*.47} ${top.y-width*.05} q ${width*.33} ${-width*.26} ${width*.66} 0`} stroke={lit("#627c73")} strokeWidth={unit*.13} fill="none"/>
  </>;
  if (element.asset_key === "gate") {
    const a = { x: p.x - width / 2, y: p.y }, b = { x: p.x + width / 2, y: p.y };
    return <g data-illustrative-gate>
      <polyline points={projected([a, b], height * .85, mode)} stroke={lit("#526d64")} strokeWidth={unit * .75} />
      <polyline points={projected([a, b], height * .85 + unit * .25, mode)} stroke={lit("#b4b9a2")} strokeWidth={unit * .15} />
      <polyline points={projected([a, b], height * .22, mode)} stroke={lit("#647b6c")} strokeWidth={unit * .18} />
      {Array.from({ length: 10 }, (_, index) => {
        const point = interpolate(a, b, (index + .5) / 10);
        return <polyline key={index} points={plainPoints([projectScenePoint(point, unit * .3, mode), projectScenePoint(point, height * .7, mode)])} stroke={lit("#778b7c")} strokeWidth={unit * .12} />;
      })}
      {[a, b].map((point, index) => {
        const radius = Math.min(width * .085, unit * .8), corners = [{ x: point.x - radius, y: point.y - radius }, { x: point.x + radius, y: point.y - radius }, { x: point.x + radius, y: point.y + radius }, { x: point.x - radius, y: point.y + radius }];
        if (mode === "2d") return <polygon key={index} points={plainPoints(corners)} fill={lit("#cbbd9c")} />;
        return <g key={index}>
          {sceneBuildingFaces(corners, height).map((face, faceIndex) => <polygon key={faceIndex} points={plainPoints(face.points)} fill={facadeColor(face,lit("#9b947c"),lit("#cbbd9c"),sunlight,lighting)} stroke={lit("#9b947c")} strokeWidth={unit * .08} />)}
          <polygon points={projected(corners, height, mode)} fill={lit("#e1d7bb")} stroke={lit("#b8ae90")} strokeWidth={unit * .15} />
          <polyline points={projected(corners.concat(corners[0]!), height * .87, mode)} fill="none" stroke={lit("#e1d7bb")} strokeWidth={unit * .22} />
          <polyline points={projected(corners.concat(corners[0]!), height * .13, mode)} fill="none" stroke={lit("#ddd1b2")} strokeWidth={unit * .26} />
          <polygon points={planeQuad({x:point.x-radius*.45,y:point.y+radius},{x:point.x+radius*.45,y:point.y+radius},height*.45,height*.7)} fill={lit("#52695f")} stroke={lit("#ddcfad")} strokeWidth={unit*.12}/>
        </g>;
      })}
    </g>;
  }
  const a = { x: p.x - width / 2, y: p.y - width * .13 }, b = { x: p.x + width / 2, y: p.y - width * .13 };
  const c = { x: b.x, y: p.y + width * .13 }, d = { x: a.x, y: c.y };
  return <>
    {mode === "2.5d" && [interpolate(a, b, .16), interpolate(a, b, .84)].map((point, index) => <polyline key={index} points={plainPoints([projectScenePoint(point), projectScenePoint(point, height * .55)])} stroke={lit("#67796c")} strokeWidth={unit * .25} />)}
    <polygon points={projected([a, b, c, d], height * .55, mode)} fill={lit("#ac8c64")} stroke={lit("#896e50")} strokeWidth={unit * .12} />
    {[.33,.66].map(position=><polyline key={position} points={projected([interpolate(a,d,position),interpolate(b,c,position)],height*.55,mode)} stroke={lit("#d4af7b")} strokeWidth={unit*.065}/>)}
    <polyline points={projected([a, b], height, mode)} stroke={lit("#bc9b70")} strokeWidth={unit * .4} />
    {mode === "2.5d" && [interpolate(a,b,.16),interpolate(a,b,.84)].map((point,index)=><polyline key={index} points={plainPoints([projectScenePoint(point,height*.4),projectScenePoint(point,height)])} stroke={lit("#596f62")} strokeWidth={unit*.14}/>)}
  </>;
}

export const SceneAssetDrawing = memo(function SceneAssetDrawing({ element, mode, unit, simple = false, lighting = "day", sunlight = DEFAULT_SCENE_SUNLIGHT, unavailable = false }: { element: CampusSceneElement; mode: SceneViewMode; unit: number; simple?: boolean; lighting?: SceneLighting; sunlight?: SceneSunlight; unavailable?:boolean }) {
  if (element.kind === 'fixture' && isSceneIndoorAssetKey(element.asset_key)) return <SceneIndoorFixture element={element} mode={mode} unit={unit} lighting={lighting}/>;
  if (element.kind === "fixture" && element.navigation_connector) return <SceneNavigationFixture element={element} mode={mode} unit={unit} lighting={lighting} />;
  if (element.kind === "fixture" && (element.asset_key === "water_point" || element.asset_key === "equipment")) return <SceneOperationalFixture element={element} mode={mode} unit={unit} lighting={lighting} />;
  if (element.kind === "building" || element.kind === "room") return <BuildingDrawing element={element} mode={mode} unit={unit} simple={simple} lighting={lighting} sunlight={sunlight} />;
  if (element.kind === "path" && element.asset_key === "boundary_wall") return <BoundaryDrawing element={element} mode={mode} unit={unit} simple={simple} lighting={lighting} sunlight={sunlight} />;
  if (element.kind === "road" || element.kind === "path") return <PathDrawing element={element} mode={mode} unit={unit} lighting={lighting} />;
  if (element.kind === "surface") return <SurfaceDrawing element={element} mode={mode} unit={unit} lighting={lighting} />;
  if (element.kind === "tree") return <TreeDrawing element={element} mode={mode} unit={unit} simple={simple} lighting={lighting} />;
  return <FixtureDrawing element={element} mode={mode} unit={unit} lighting={lighting} sunlight={sunlight} unavailable={unavailable} />;
});

export const SceneElementShadow = memo(function SceneElementShadow({ element, unit, sunlight = DEFAULT_SCENE_SUNLIGHT }: { element: CampusSceneElement; unit: number; sunlight?: SceneSunlight }) {
  const gradientId=`scene-contact-${useId().replace(/:/g,"")}`;
  const height = sceneElementHeight(element, unit), point = element.geometry.points[0];
  if (!height || !point) return null;
  const width = sceneElementWidth(element, unit);
  const offset = sceneShadowOffset(scenePresentationHeight(height),sunlight), night = sunlight.strength <= 0;
  if (element.kind === "tree" || element.kind === "fixture") {
    const length = Math.hypot(offset.x,offset.y), angle = Math.atan2(offset.y,offset.x)*180/Math.PI;
    const center = {x:point.x+offset.x*.72,y:point.y+offset.y*.72};
    return <g data-scene-shadow={night ? "contact" : "sun"} transform={SCENE_PLANE_TRANSFORM} fill={night ? "#080e12" : "#304936"} opacity={night ? .2 : .14 + sunlight.strength * .09}>
      <defs><radialGradient id={gradientId}><stop offset="0" stopColor={night ? "#080e12" : "#304936"}/><stop offset=".55" stopColor={night ? "#080e12" : "#304936"} stopOpacity=".8"/><stop offset="1" stopColor={night ? "#080e12" : "#304936"} stopOpacity="0"/></radialGradient></defs>
      {!night && <path d={`M ${point.x} ${point.y} L ${center.x} ${center.y}`} stroke="#304936" strokeWidth={width*.16} />}
      <ellipse cx={center.x} cy={center.y} rx={width*.62+length*.24} ry={width*.48} fill={`url(#${gradientId})`} transform={`rotate(${angle} ${center.x} ${center.y})`} />
    </g>;
  }
  if (element.kind !== "building" && element.kind !== "room") return null;
  const points = element.geometry.points, shifted = points.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y }));
  if (night) return <polygon data-scene-shadow="contact" points={plainPoints(points)} transform={SCENE_PLANE_TRANSFORM} fill="#080e12" stroke="#080e12" strokeWidth={unit*1.3} opacity={.24} strokeLinejoin="round" />;
  return <g data-scene-shadow="sun" transform={SCENE_PLANE_TRANSFORM} fill="#304936" opacity={.14 + sunlight.strength*.08}>
    <polygon points={plainPoints(shifted)} />
    {points.map((p, index) => <polygon key={index} points={plainPoints([p, points[(index + 1) % points.length]!, shifted[(index + 1) % points.length]!, shifted[index]!])} />)}
  </g>;
});

export function SceneElementOutline({ element, mode, unit, scale }: { element: CampusSceneElement; mode: SceneViewMode; unit: number; scale: number }) {
  const height = sceneElementHeight(element, unit), points = element.geometry.points;
  const common = { fill: "none", stroke: "var(--thatcampus-action)", strokeWidth: 2.5 / scale };
  if (element.kind === "fixture" && isSceneIndoorAssetKey(element.asset_key)) return <polygon {...common} points={projected(sceneIndoorFootprint(element,unit),0,mode)} strokeLinejoin="round" />;
  if (element.geometry.type === "polygon") return <polygon {...common} points={projected(points, height, mode)} strokeLinejoin="round" />;
  if (element.geometry.type === "polyline") return <polyline {...common} points={projected(points, 0, mode)} strokeWidth={sceneElementWidth(element, unit) + 3 / scale} strokeOpacity={.65} strokeLinecap="round" />;
  const center = projectScenePoint(points[0]!, mode === "2.5d" ? height * .7 : 0, mode);
  return <ellipse {...common} cx={center.x} cy={center.y} rx={sceneElementWidth(element, unit) * .65} ry={sceneElementWidth(element, unit) * .55} />;
}

