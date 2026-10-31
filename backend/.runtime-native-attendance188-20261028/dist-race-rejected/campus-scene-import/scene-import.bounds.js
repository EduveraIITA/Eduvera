const point = (value) => Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && Number.isFinite(value[0]) && typeof value[1] === 'number' && Number.isFinite(value[1]);
const inside = (p, b) => p[0] >= b.west && p[0] <= b.east && p[1] >= b.south && p[1] <= b.north;
function segment(a, z, b) {
    const dx = z[0] - a[0], dy = z[1] - a[1];
    let enter = 0, exit = 1;
    const edges = [[-dx, a[0] - b.west], [dx, b.east - a[0]], [-dy, a[1] - b.south], [dy, b.north - a[1]]];
    for (const [p, q] of edges) {
        if (p === 0) {
            if (q < 0)
                return null;
            continue;
        }
        const t = q / p;
        if (p < 0)
            enter = Math.max(enter, t);
        else
            exit = Math.min(exit, t);
        if (enter > exit)
            return null;
    }
    if (enter === exit)
        return null;
    const at = (t) => [Math.min(b.east, Math.max(b.west, a[0] + t * dx)), Math.min(b.north, Math.max(b.south, a[1] + t * dy))];
    return [at(enter), at(exit)];
}
/** Overpass returns entire intersecting ways. Keep only the requested area;
 * never turn a cropped building into a purported complete footprint. */
export function boundMapFeatures(raw, bounds) {
    if (!raw || typeof raw !== 'object' || !('features' in raw) || !Array.isArray(raw.features))
        return raw;
    const features = [];
    for (const item of raw.features) {
        if (!item || typeof item !== 'object' || !('geometry' in item))
            continue;
        const geometry = item.geometry;
        if (geometry.type === 'Point' && point(geometry.coordinates) && inside(geometry.coordinates, bounds))
            features.push(item);
        if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates) && geometry.coordinates.every(ring => Array.isArray(ring) && ring.every(p => point(p) && inside(p, bounds))))
            features.push(item);
        if (geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates) || !geometry.coordinates.every(point))
            continue;
        const coordinates = geometry.coordinates;
        let current = [];
        let part = 0;
        const finish = () => { if (current.length > 1)
            features.push({ ...item, id: `${String(item.id ?? 'path')}-clip-${++part}`, geometry: { type: 'LineString', coordinates: current } }); current = []; };
        for (let i = 1; i < coordinates.length; i++) {
            const clipped = segment(coordinates[i - 1], coordinates[i], bounds);
            if (!clipped) {
                finish();
                continue;
            }
            const last = current.at(-1);
            if (last && (last[0] !== clipped[0][0] || last[1] !== clipped[0][1]))
                finish();
            if (!current.length)
                current.push(clipped[0]);
            current.push(clipped[1]);
        }
        finish();
    }
    return { type: 'FeatureCollection', features };
}
//# sourceMappingURL=scene-import.bounds.js.map