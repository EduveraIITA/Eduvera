import Konva from "konva";
import type { Circle as KonvaCircle } from "konva/lib/shapes/Circle";
import { Circle, Group, Layer, Line, Rect, Stage, Text } from "react-konva";
import { useEffect, useMemo, useRef } from "react";
import { CampusMapControls } from "./CampusMapControls";
import { CAMPUS_VIEW_BOX, mapDisplayDimension, schematicElements, strongestDimension } from "./geometry";
import { RoomSeatPattern } from "./RoomSeatPattern";
import { plannedHeadcount, roomCapacityPresentation, supportsSeatPattern } from "./roomOccupancy";
import type { MapBounds } from "./mapViewport";
import type { CampusPlanElement, CampusTruthDimension, CampusViewSpace, CampusViewZoneOverlay } from "./types";
import { useCampusMapViewport } from "./useCampusMapViewport";

const palette = {
  ink: "#10223b", muted: "#66768c", brand: "#155dd7", brandSoft: "#e9f1ff",
  observed: "#0a8c78", observedSoft: "#def4ee", accepted: "#08775f",
  warning: "#b56f0a", warningSoft: "#fff0cf", ground: "#dfeadf", grass: "#cddfcf",
  path: "#d8d0bd", wall: "#8795a7", wallInner: "#d7dee7", corridor: "#f2ede1", room: "#fbfcfe",
} as const;

function Tree({ x, y, size = 22 }: { x: number; y: number; size?: number }) {
  return <Group x={x} y={y} listening={false}>
    <Circle radius={size + 5} fill="rgba(31, 91, 55, .08)" />
    <Circle x={-size * .28} y={2} radius={size * .62} fill="#79aa7e" />
    <Circle x={size * .26} y={-4} radius={size * .7} fill="#5f9868" />
    <Circle y={-size * .35} radius={size * .64} fill="#8ab68c" />
    <Circle radius={size * .24} fill="#356741" />
  </Group>;
}

function dimensionStyle(dimension: CampusTruthDimension, issue: boolean) {
  if (issue) return { fill: "#fffaf0", accent: palette.warning };
  if (dimension === "accepted") return { fill: "#f3fbf8", accent: palette.accepted };
  if (dimension === "observed") return { fill: "#f5fbfa", accent: palette.observed };
  if (dimension === "expected") return { fill: "#f7faff", accent: palette.brand };
  return { fill: palette.room, accent: palette.wall };
}

function FreshSignalMarker({ x, y, dimension }: { x: number; y: number; dimension: "observed" | "accepted" }) {
  const pulse = useRef<KonvaCircle>(null);
  useEffect(() => {
    const node = pulse.current;
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = new Konva.Animation((frame) => {
      const progress = ((frame?.time ?? 0) % 1800) / 1800;
      node.radius(7 + progress * 14);
      node.opacity(.42 * (1 - progress));
    }, node.getLayer());
    animation.start();
    return () => { animation.stop(); };
  }, []);
  const fill = dimension === "accepted" ? palette.accepted : palette.observed;
  return <Group x={x} y={y} listening={false}>
    <Circle ref={pulse} radius={7} fill={fill} opacity={.42} />
    <Circle radius={6} fill={fill} stroke="#fff" strokeWidth={2} shadowColor={fill} shadowBlur={8} />
  </Group>;
}

function Room({ element, space, overlay, selected, mapCenterX, onSelect }: {
  element: CampusPlanElement;
  space: CampusViewSpace;
  overlay?: CampusViewZoneOverlay;
  selected: boolean;
  mapCenterX: number;
  onSelect: (space: CampusViewSpace) => void;
}) {
  const evidenceDimension = strongestDimension(space);
  const dimension = mapDisplayDimension(space, overlay?.state_dimension);
  const style = dimensionStyle(dimension, space.signal_count > 0);
  const expectedNow = space.expected_now[0];
  const gateToday = space.gate_activity_today;
  const activity = gateToday
    ? `${gateToday.entries} in · ${gateToday.exits} out today`
    : overlay?.title || expectedNow?.subject_label || expectedNow?.title
      || space.assertions.accepted[0]?.label || space.assertions.observed[0]?.label || space.assertions.expected[0]?.label;
  const expectedDetail = expectedNow
    ? `${expectedNow.class_label}${expectedNow.teacher ? ` · Expected: ${expectedNow.teacher.label}` : " · Teacher unassigned"}`
    : null;
  const plannedCount = plannedHeadcount(
    [expectedNow?.expected_count, ...space.assertions.expected.map((item) => item.count)],
    overlay?.count,
  );
  const seating = supportsSeatPattern(space.kind)
    ? roomCapacityPresentation(space.id, space.capacity, plannedCount)
    : null;
  const dense = element.width < 140 || element.height < 100;
  const roomy = element.height >= 180;
  const compact = element.height >= 120;
  const seatPatternTop = roomy ? 102 : compact ? 84 : dense ? 48 : 51;
  const seatPatternHeight = roomy ? Math.max(18, element.height - 152) : compact ? Math.max(12, element.height - 120) : Math.max(8, element.height - (dense ? 55 : 78));
  const doorOnRight = element.x < mapCenterX;
  const labelInset = dense ? 7 : 16;
  const labelWidth = Math.max(42, element.width - labelInset * 2);
  const doorY = seating ? element.y + element.height - 35 : element.y + element.height * .64;
  const status = space.signal_count
    ? `${space.signal_count} item${space.signal_count === 1 ? "" : "s"} to review`
    : gateToday ? `${gateToday.accepted_points} accepted point${gateToday.accepted_points === 1 ? "" : "s"}`
    : overlay?.marker_label || (dimension === "accepted" ? "Accepted now" : dimension === "observed" ? "Observed now" : dimension === "expected" ? "Expected now" : "No current signal");
  return <Group
    onClick={() => onSelect(space)} onTap={() => onSelect(space)}
    onMouseEnter={(event) => { event.target.getStage()!.container().style.cursor = "pointer"; }}
    onMouseLeave={(event) => { event.target.getStage()!.container().style.cursor = "grab"; }}
  >
    <Rect x={element.x} y={element.y} width={element.width} height={element.height} cornerRadius={7}
      fill={style.fill} stroke={selected ? palette.brand : palette.wall} strokeWidth={selected ? 4 : 2}
      strokeScaleEnabled={false}
      shadowColor="#25476f" shadowOpacity={selected ? .16 : .055} shadowBlur={selected ? 14 : 5} shadowOffsetY={3} />
    <Rect x={element.x + 5} y={element.y + 5} width={Math.max(0, element.width - 10)} height={Math.max(0, element.height - 10)} cornerRadius={4}
      stroke={palette.wallInner} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
    {!dense && (compact || !seating) ? <>
      <Line points={doorOnRight
        ? [element.x + element.width, doorY, element.x + element.width - 30, doorY]
        : [element.x, doorY, element.x + 30, doorY]}
        stroke={palette.corridor} strokeWidth={8} />
      <Line points={doorOnRight
        ? [element.x + element.width - 30, doorY, element.x + element.width - 30, doorY + 24]
        : [element.x + 30, doorY, element.x + 30, doorY + 24]}
        stroke="#9aa8b8" strokeWidth={2} />
    </> : null}
    <Text x={element.x + labelInset} y={element.y + (dense ? 8 : 17)} width={labelWidth} text={space.name} fontFamily="Plus Jakarta Sans" fontStyle="bold" fontSize={dense ? 9 : 18} fill={palette.ink} ellipsis wrap="none" />
    {compact || dense ? <Text x={element.x + labelInset} y={element.y + (dense ? 25 : 48)} width={labelWidth} text={activity || "No current assertion"} fontFamily="Plus Jakarta Sans" fontSize={dense ? 7 : 12} lineHeight={1.35} fill={gateToday ? palette.accepted : palette.muted} ellipsis height={dense ? 12 : 18} wrap="none" /> : null}
    {roomy && expectedDetail ? <Text x={element.x + 16} y={element.y + 65} width={labelWidth} text={expectedDetail} fontFamily="Plus Jakarta Sans" fontSize={9} fill={palette.muted} ellipsis height={15} wrap="none" /> : null}
    {seating ? <>
      <Text x={element.x + labelInset} y={element.y + (roomy ? 84 : compact ? 67 : dense ? 36 : 39)} width={labelWidth} text={seating.compactLabel} fontFamily="Plus Jakarta Sans" fontStyle="bold" fontSize={dense ? 6 : compact ? 10 : 8} fill={seating.overflowCount ? palette.warning : palette.ink} ellipsis wrap="none" />
      <RoomSeatPattern presentation={seating} x={element.x + labelInset} y={element.y + seatPatternTop} width={element.width - labelInset * 2} height={seatPatternHeight} />
    </> : null}
    {compact ? <Text x={element.x + 16} y={element.y + element.height - 30} width={labelWidth} text={status} fontFamily="Plus Jakarta Sans" fontStyle="bold" fontSize={10} fill={space.signal_count ? palette.warning : dimension === "unknown" ? palette.muted : style.accent} /> : null}
    {evidenceDimension === "observed" || evidenceDimension === "accepted" ? <FreshSignalMarker x={element.x + element.width - 17} y={element.y + element.height - 17} dimension={evidenceDimension} /> : null}
  </Group>;
}

function CampusGround({ bounds, configured }: { bounds: MapBounds; configured: boolean }) {
  if (configured) {
    const inset = Math.max(14, Math.min(bounds.width, bounds.height) * .025);
    return <Layer listening={false}>
      <Rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill={palette.ground} />
      <Rect x={bounds.x + inset} y={bounds.y + inset} width={bounds.width - inset * 2} height={bounds.height - inset * 2} cornerRadius={32} fill={palette.grass} stroke="#9db9a1" strokeWidth={2} />
      <Line points={[bounds.x + bounds.width * .08, bounds.y + bounds.height * .82, bounds.x + bounds.width * .9, bounds.y + bounds.height * .82]} stroke={palette.path} strokeWidth={24} lineCap="round" opacity={.62} />
      <Line points={[bounds.x + bounds.width * .42, bounds.y + bounds.height * .98, bounds.x + bounds.width * .42, bounds.y + bounds.height * .72]} stroke={palette.path} strokeWidth={28} lineCap="round" opacity={.72} />
      <Tree x={bounds.x + inset * 1.8} y={bounds.y + inset * 1.8} size={13} />
      <Tree x={bounds.x + bounds.width - inset * 1.8} y={bounds.y + inset * 1.8} size={14} />
      <Tree x={bounds.x + inset * 1.8} y={bounds.y + bounds.height - inset * 1.8} size={12} />
      <Tree x={bounds.x + bounds.width - inset * 1.8} y={bounds.y + bounds.height - inset * 1.8} size={13} />
    </Layer>;
  }
  return <Layer listening={false}>
    <Rect width={CAMPUS_VIEW_BOX.width} height={CAMPUS_VIEW_BOX.height} fill={palette.ground} />
    <Rect x={24} y={26} width={712} height={868} cornerRadius={40} fill={palette.grass} stroke="#9db9a1" strokeWidth={2} />
    <Line points={[379, 895, 379, 794, 379, 458]} stroke={palette.path} strokeWidth={58} lineCap="round" lineJoin="round" />
    <Line points={[379, 458, 104, 458, 104, 120]} stroke={palette.path} strokeWidth={28} lineCap="round" lineJoin="round" opacity={.68} />
    <Tree x={57} y={83} size={20} /><Tree x={700} y={96} size={24} /><Tree x={51} y={816} size={19} /><Tree x={699} y={822} size={21} />
    <Tree x={58} y={448} size={16} /><Tree x={701} y={443} size={17} />
    <Rect x={72} y={126} width={616} height={666} cornerRadius={12} fill="#f9fafb" stroke="#aeb9c5" strokeWidth={5} shadowColor="#27415e" shadowOpacity={.14} shadowBlur={22} shadowOffsetY={10} />
    <Rect x={80} y={402} width={600} height={118} fill={palette.corridor} stroke="#c5bdad" strokeWidth={2} />
    <Line points={[100, 461, 660, 461]} stroke="#c9c1b2" strokeWidth={2} dash={[10, 12]} />
    <Text x={250} y={449} width={260} align="center" text="CENTRAL WALKWAY" fontFamily="Plus Jakarta Sans" fontStyle="bold" fontSize={10} letterSpacing={2} fill="#9a8e79" />
    <Rect x={340} y={770} width={80} height={24} fill={palette.path} />
    <Line points={[340, 792, 340, 748]} stroke="#78889a" strokeWidth={4} /><Line points={[420, 792, 420, 748]} stroke="#78889a" strokeWidth={4} />
    <Text x={272} y={837} width={216} align="center" text="CAMPUS ENTRANCE" fontFamily="Plus Jakarta Sans" fontStyle="bold" fontSize={11} letterSpacing={1.5} fill="#496553" />
    <Circle x={379} y={882} radius={7} fill={palette.brand} /><Circle x={379} y={882} radius={15} stroke={palette.brand} opacity={.22} />
  </Layer>;
}

export function CampusFloorPlan({ spaces, mappedElements, overlayZones = [], selectedId, resetKey, onSelect }: {
  spaces: CampusViewSpace[];
  mappedElements?: CampusPlanElement[];
  overlayZones?: CampusViewZoneOverlay[];
  selectedId?: string | null;
  resetKey: string;
  onSelect: (space: CampusViewSpace) => void;
}) {
  const plan = useMemo(() => {
    const mapped = (mappedElements ?? []).filter((element) => spaces.some((space) => space.id === element.space_id));
    const configured = Boolean(spaces.length) && mapped.length === spaces.length;
    const elements = configured ? mapped : schematicElements(spaces);
    const padding = 28;
    const bounds = configured && elements.length ? {
      x: Math.max(0, Math.min(...elements.map((element) => element.x)) - padding),
      y: Math.max(0, Math.min(...elements.map((element) => element.y)) - padding),
      width: Math.max(...elements.map((element) => element.x + element.width)) - Math.max(0, Math.min(...elements.map((element) => element.x)) - padding) + padding,
      height: Math.max(...elements.map((element) => element.y + element.height)) - Math.max(0, Math.min(...elements.map((element) => element.y)) - padding) + padding,
    } : CAMPUS_VIEW_BOX;
    return { elements, configured, bounds };
  }, [mappedElements, spaces]);
  const { elements, configured, bounds } = plan;
  const { hostRef, stageRef, size, viewport, dragBound, onWheel, onDragEnd, onTouchMove, onTouchEnd, zoomIn, zoomOut, fit } = useCampusMapViewport(resetKey, bounds);
  const spacesById = useMemo(() => new Map(spaces.map((space) => [space.id, space])), [spaces]);
  const overlays = useMemo(() => new Map(overlayZones.map((zone) => [zone.space_id, zone])), [overlayZones]);
  return <div ref={hostRef} className="campus-view-canvas" data-testid="campus-view-canvas">
    <Stage ref={stageRef} width={size.width} height={size.height} x={viewport.x} y={viewport.y}
      scaleX={viewport.scale} scaleY={viewport.scale} draggable dragBoundFunc={dragBound}
      onWheel={onWheel} onDragEnd={onDragEnd} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
      aria-hidden="true">
      <CampusGround bounds={bounds} configured={configured} />
      <Layer>{elements.map((element) => {
        const space = spacesById.get(element.space_id);
        return space ? <Room key={element.id} element={element} space={space} overlay={overlays.get(space.id)} selected={space.id === selectedId} mapCenterX={bounds.x + bounds.width / 2} onSelect={onSelect} /> : null;
      })}</Layer>
    </Stage>
    <CampusMapControls onZoomIn={zoomIn} onZoomOut={zoomOut} onFit={fit} />
  </div>;
}
