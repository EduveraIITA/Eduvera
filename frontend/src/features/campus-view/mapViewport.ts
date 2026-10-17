export interface MapPoint {
  x: number;
  y: number;
}

export interface MapSize {
  width: number;
  height: number;
}

export interface MapBounds extends MapPoint, MapSize {}

export interface MapViewport extends MapPoint {
  scale: number;
}

export function fitMapViewport(container: MapSize, bounds: MapBounds, padding: number): MapViewport {
  const availableWidth = Math.max(1, container.width - padding * 2);
  const availableHeight = Math.max(1, container.height - padding * 2);
  const scale = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
  return {
    scale,
    x: (container.width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (container.height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}

export function mapScaleRange(fitScale: number) {
  return {
    min: Math.max(.12, fitScale * .78),
    max: Math.max(2.4, fitScale * 4),
  };
}

export function clampMapScale(scale: number, fitScale: number) {
  const range = mapScaleRange(fitScale);
  return Math.min(range.max, Math.max(range.min, scale));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function constrainMapViewport(
  viewport: MapViewport,
  container: MapSize,
  bounds: MapBounds,
  visibleEdge = 72,
): MapViewport {
  const scaledWidth = bounds.width * viewport.scale;
  const scaledHeight = bounds.height * viewport.scale;
  const minX = container.width - (bounds.x + bounds.width) * viewport.scale - visibleEdge;
  const maxX = visibleEdge - bounds.x * viewport.scale;
  const minY = container.height - (bounds.y + bounds.height) * viewport.scale - visibleEdge;
  const maxY = visibleEdge - bounds.y * viewport.scale;
  return {
    ...viewport,
    x: scaledWidth <= container.width
      ? (container.width - scaledWidth) / 2 - bounds.x * viewport.scale
      : clamp(viewport.x, Math.min(minX, maxX), Math.max(minX, maxX)),
    y: scaledHeight <= container.height
      ? (container.height - scaledHeight) / 2 - bounds.y * viewport.scale
      : clamp(viewport.y, Math.min(minY, maxY), Math.max(minY, maxY)),
  };
}

export function zoomMapAtPoint(viewport: MapViewport, point: MapPoint, nextScale: number): MapViewport {
  const worldPoint = {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
  return {
    scale: nextScale,
    x: point.x - worldPoint.x * nextScale,
    y: point.y - worldPoint.y * nextScale,
  };
}

export function pinchMapViewport(
  viewport: MapViewport,
  previousCenter: MapPoint,
  previousDistance: number,
  currentCenter: MapPoint,
  currentDistance: number,
  fitScale: number,
): MapViewport {
  if (previousDistance <= 0 || currentDistance <= 0) return viewport;
  const nextScale = clampMapScale(viewport.scale * (currentDistance / previousDistance), fitScale);
  const anchored = zoomMapAtPoint(viewport, previousCenter, nextScale);
  return {
    ...anchored,
    x: anchored.x + currentCenter.x - previousCenter.x,
    y: anchored.y + currentCenter.y - previousCenter.y,
  };
}

export function preserveMapCenter(viewport: MapViewport, previous: MapSize, next: MapSize): MapViewport {
  const worldCenter = {
    x: (previous.width / 2 - viewport.x) / viewport.scale,
    y: (previous.height / 2 - viewport.y) / viewport.scale,
  };
  return {
    ...viewport,
    x: next.width / 2 - worldCenter.x * viewport.scale,
    y: next.height / 2 - worldCenter.y * viewport.scale,
  };
}
