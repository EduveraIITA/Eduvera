import { BadRequestException } from '@nestjs/common';
import { polygonIsSimple, sceneDocumentSchema } from '../campus-scenes/campus-scenes.contracts.js';
const MAX_IMPORT_POINTS = 20_000;
function record(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function pair(value) {
    if (!Array.isArray(value) || value.length < 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1]))
        return null;
    const [lon, lat] = value;
    return Math.abs(lon) <= 180 && Math.abs(lat) <= 85 ? { lon: lon, lat: lat } : null;
}
function coordinates(value) {
    if (!Array.isArray(value))
        return null;
    const points = value.map(pair);
    // Dropping a malformed vertex changes the source footprint; omit the entire feature instead.
    return points.every((point) => point !== null) ? points : null;
}
function positive(value, maximum) {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim().replace(/\s*m$/u, '')) : NaN;
    return Number.isFinite(parsed) && parsed > 0 && parsed <= maximum ? parsed : undefined;
}
function tagText(value) { return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''; }
function tagEnabled(value) { return !['no', 'false', '0', ''].includes(tagText(value).toLowerCase()); }
function label(properties, fallback) {
    const value = properties.name ?? properties['name:en'];
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : fallback;
}
function tidy(points, polygon) {
    const result = points.filter((point, index) => !index || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
    if (polygon && result.length > 1 && result[0].x === result.at(-1).x && result[0].y === result.at(-1).y)
        result.pop();
    return result;
}
function pointKind(properties) {
    if (properties.natural === 'tree' || properties.kind === 'tree')
        return 'tree';
    if (properties.barrier === 'gate' || properties.kind === 'gate' || properties.asset_key === 'gate')
        return 'gate';
    if (properties.amenity === 'bench' || properties.asset_key === 'bench')
        return 'bench';
    if (properties.highway === 'street_lamp' || properties.asset_key === 'lamp')
        return 'lamp';
    return null;
}
function lineKind(properties) {
    if (properties.kind === 'road')
        return 'road';
    if (properties.kind === 'path')
        return 'path';
    const highway = tagText(properties.highway);
    if (['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living_street', 'service', 'unclassified', 'road'].includes(highway))
        return 'road';
    return ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track', 'bridleway'].includes(highway) ? 'path' : null;
}
/** Source-backed outlines only. Courtyard holes are omitted until the scene schema supports rings. */
export function sceneFromGeoJson(input, name, source) {
    if (!source.attribution?.trim())
        throw new BadRequestException('Include the map data attribution before importing it.');
    if (!record(input) || input.type !== 'FeatureCollection' || !Array.isArray(input.features) || input.features.length > 5000)
        throw new BadRequestException('Upload a GeoJSON FeatureCollection with no more than 5,000 features.');
    const extracted = [];
    let omitted = 0, courtyardParts = 0, pointCount = 0;
    for (const [featureIndex, raw] of input.features.entries()) {
        if (!record(raw)) {
            omitted++;
            continue;
        }
        const feature = raw, geometry = feature.geometry;
        if (feature.type !== 'Feature' || !geometry || !Array.isArray(geometry.coordinates)) {
            omitted++;
            continue;
        }
        const properties = record(feature.properties) ? feature.properties : {};
        const shape = geometry.type === 'Point' ? 'point' : geometry.type === 'LineString' ? 'polyline' : 'polygon';
        if (shape === 'point' && !pointKind(properties) || shape === 'polyline' && !lineKind(properties)) {
            omitted++;
            continue;
        }
        const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : geometry.type === 'Polygon' ? [geometry.coordinates] : null;
        const sets = [];
        if (polygons)
            for (const polygon of polygons) {
                if (!Array.isArray(polygon) || polygon.length !== 1) {
                    omitted++;
                    if (Array.isArray(polygon) && polygon.length > 1)
                        courtyardParts++;
                    continue;
                }
                sets.push(polygon[0]);
            }
        else if (geometry.type === 'Point')
            sets.push([geometry.coordinates]);
        else if (geometry.type === 'LineString')
            sets.push(geometry.coordinates);
        else {
            omitted++;
            continue;
        }
        for (const set of sets) {
            const points = coordinates(set);
            if (!points || points.length < (shape === 'polygon' ? 4 : shape === 'polyline' ? 2 : 1) || points.length > (shape === 'polygon' ? 501 : 500)) {
                omitted++;
                continue;
            }
            if (shape === 'polygon' && (points[0].lon !== points.at(-1).lon || points[0].lat !== points.at(-1).lat)) {
                omitted++;
                continue;
            }
            pointCount += points.length;
            if (pointCount > MAX_IMPORT_POINTS)
                throw new BadRequestException('Simplify this map to no more than 20,000 source points before importing.');
            // The local feature ordinal groups only this import's polygon parts.
            // External IDs/names may repeat; they cannot establish campus identity.
            extracted.push({ properties, points, shape, sourceFeatureId: `geojson-feature-${featureIndex + 1}` });
        }
    }
    if (!extracted.length)
        throw new BadRequestException(courtyardParts ? 'These polygons contain courtyard holes. Draw their separate building wings in the editor; the holes have not been filled.' : 'No supported, valid building outlines, paths or landscape features were found in this map data.');
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (const item of extracted)
        for (const point of item.points) {
            west = Math.min(west, point.lon);
            east = Math.max(east, point.lon);
            south = Math.min(south, point.lat);
            north = Math.max(north, point.lat);
        }
    const scaleX = 111_320 * Math.cos((south + north) / 2 * Math.PI / 180), scaleY = 111_320;
    const width = Math.max(80, (east - west) * scaleX + 40), height = Math.max(80, (north - south) * scaleY + 40);
    if (width > 10_000 || height > 10_000)
        throw new BadRequestException('Choose a single campus. This map covers more than 10 km.');
    const elements = [];
    for (const { properties, points: raw, shape, sourceFeatureId } of extracted) {
        if (elements.length >= 1000) {
            omitted++;
            continue;
        }
        const points = tidy(raw.map(p => ({ x: Math.round(((p.lon - west) * scaleX + 20) * 100) / 100, y: Math.round(((north - p.lat) * scaleY + 20) * 100) / 100 })), shape === 'polygon');
        if (shape === 'polygon' && !polygonIsSimple(points) || shape === 'polyline' && points.length < 2) {
            omitted++;
            continue;
        }
        const building = shape === 'polygon' && (tagEnabled(properties.building) || tagEnabled(properties['building:part']) || properties.kind === 'building' || properties.type === 'building');
        const pointAsset = shape === 'point' ? pointKind(properties) : null, line = shape === 'polyline' ? lineKind(properties) : null;
        const water = properties.natural === 'water' || properties.leisure === 'swimming_pool';
        const sports = properties.leisure === 'pitch' && ['soccer', 'football'].includes(tagText(properties.sport)), parking = properties.amenity === 'parking';
        const grass = ['grass', 'meadow', 'recreation_ground'].includes(tagText(properties.landuse)) || ['park', 'garden'].includes(tagText(properties.leisure)) || properties.natural === 'grassland';
        const kind = building ? 'building' : shape === 'polygon' ? 'surface' : line ?? (pointAsset === 'tree' ? 'tree' : 'fixture');
        const levels = positive(properties['building:levels'], 100), buildingHeight = positive(properties.height, 1000);
        const pointLabel = pointAsset === 'tree' ? 'Tree' : pointAsset === 'gate' ? 'Gate' : pointAsset === 'bench' ? 'Bench' : 'Lamp';
        const fallback = building ? 'Building' : shape === 'point' ? pointLabel : line === 'road' ? 'Road' : line === 'path' ? 'Path' : water ? 'Water' : sports ? 'Sports ground' : parking ? 'Parking' : grass ? 'Lawn' : 'Map surface';
        const asset = building ? 'generic' : pointAsset === 'tree' ? 'tree_broadleaf' : pointAsset ?? (water ? 'water' : sports ? 'sports' : parking ? 'parking' : grass ? 'grass' : line === 'path' ? 'paving' : 'generic');
        const material = building ? 'concrete' : pointAsset === 'tree' || grass || sports ? 'grass' : pointAsset === 'bench' ? 'wood' : pointAsset ? 'metal' : water ? 'water' : line === 'road' || parking ? 'asphalt' : line === 'path' ? 'paving' : 'neutral';
        elements.push({ id: `map_${elements.length + 1}`, source_feature_id: sourceFeatureId, kind, label: label(properties, `${fallback} ${elements.length + 1}`), geometry: { type: shape, points }, space_id: null, floor_id: null, review_state: 'needs_review', asset_key: asset, material,
            ...(building ? { roof: 'flat', ...(levels && Number.isInteger(levels) ? { levels } : {}), ...(buildingHeight ? { height: buildingHeight } : {}) } : {}),
            ...(line ? { width: positive(properties.width, 100) ?? (line === 'road' ? 6 : 2.5) } : pointAsset === 'tree' ? { width: 7, height: 9 } : pointAsset === 'gate' ? { width: 5, height: 3 } : pointAsset === 'bench' ? { width: 2, height: 1 } : pointAsset === 'lamp' ? { width: 1, height: 6 } : {}), });
    }
    if (!elements.length)
        throw new BadRequestException('The map outlines could not be imported. Draw the missing outlines in the editor.');
    const notes = ['Imported outlines need review. Heights, vegetation and path widths without source values are visual estimates; this local projection is not a survey or a walking route.', 'Interior rooms need separate plans.', courtyardParts ? `${courtyardParts} polygon part(s) with courtyard holes were omitted; draw separate wings to preserve them.` : '', omitted ? `${omitted} unsupported or invalid feature(s) were omitted.` : '', source.notes ?? ''].filter(Boolean).join(' ').slice(0, 1000);
    const document = { schema_version: 1, name, bounds: { width: Math.ceil(width), height: Math.ceil(height), unit: 'metres' }, source: { ...source, attribution: source.attribution.trim(), notes }, elements };
    const checked = sceneDocumentSchema.safeParse(document);
    if (!checked.success)
        throw new BadRequestException('This map is too complex to import as one campus. Use a smaller boundary or simplify its outlines.');
    return checked.data;
}
export function osmToGeoJson(input) {
    if (!record(input) || !Array.isArray(input.elements) || input.elements.length > 10_000)
        throw new BadRequestException('The map provider returned an unreadable or oversized response.');
    const features = [];
    for (const raw of input.elements) {
        if (!record(raw) || !record(raw.tags))
            continue;
        const tags = raw.tags;
        if (raw.type === 'node' && typeof raw.lon === 'number' && typeof raw.lat === 'number') {
            features.push({ type: 'Feature', id: `node/${tagText(raw.id)}`, properties: tags, geometry: { type: 'Point', coordinates: [raw.lon, raw.lat] } });
            continue;
        }
        if (raw.type !== 'way' || !Array.isArray(raw.geometry) || raw.geometry.length > 501)
            continue;
        // Keep malformed vertices so the importer rejects the whole geometry rather than joining across a gap.
        const points = raw.geometry.map(p => record(p) ? [p.lon, p.lat] : [null, null]);
        const polygon = tags.area !== 'no' && (tagEnabled(tags.building) || tagEnabled(tags['building:part']) || tagEnabled(tags.landuse) || ['pitch', 'park', 'garden', 'swimming_pool', 'track'].includes(tagText(tags.leisure)) || ['water', 'grassland'].includes(tagText(tags.natural)) || tags.amenity === 'parking');
        features.push({ type: 'Feature', id: `way/${tagText(raw.id)}`, properties: tags, geometry: { type: polygon ? 'Polygon' : 'LineString', coordinates: polygon ? [points] : points } });
    }
    return { type: 'FeatureCollection', features };
}
//# sourceMappingURL=scene-import.geometry.js.map