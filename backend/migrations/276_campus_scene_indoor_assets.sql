-- Extend the existing scene guard for editable indoor presentation assets.
-- Canonical links, navigation, holding authority and invoker privileges are unchanged.
CREATE OR REPLACE FUNCTION campus_scene_links_valid(tenant uuid,campus uuid,document jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH RECURSIVE
 elements AS (SELECT value AS element FROM jsonb_array_elements(document->'elements')),
 endpoints AS (
  SELECT element, endpoint.space_id
  FROM elements CROSS JOIN LATERAL (VALUES
   (element->'navigation'->>'start_space_id'),
   (element->'navigation'->>'end_space_id')) endpoint(space_id)
  WHERE endpoint.space_id IS NOT NULL
 ),
 connector_floors AS (
  SELECT element, floor.floor_id FROM elements CROSS JOIN LATERAL (VALUES
   (element->'navigation_connector'->>'from_floor_id'),(element->'navigation_connector'->>'to_floor_id')) floor(floor_id)
  WHERE floor.floor_id IS NOT NULL
 ),
 connector_ancestors AS (
  SELECT connector.element,connector.floor_id,space.id,space.parent_space_id,ARRAY[space.id] AS visited
  FROM connector_floors connector JOIN campus_spaces space ON space.school_id=tenant AND space.campus_id=campus AND space.id::text=connector.floor_id AND space.status='active' AND space.kind='floor'
  UNION ALL
  SELECT ancestor.element,ancestor.floor_id,parent.id,parent.parent_space_id,ancestor.visited||parent.id
  FROM connector_ancestors ancestor JOIN campus_spaces parent ON parent.school_id=tenant AND parent.campus_id=campus AND parent.id=ancestor.parent_space_id AND parent.status='active'
  WHERE NOT parent.id=ANY(ancestor.visited)
 ),
 endpoint_ancestors AS (
  SELECT endpoint.element, endpoint.space_id, space.id, space.parent_space_id, space.kind, ARRAY[space.id] AS visited
  FROM endpoints endpoint JOIN campus_spaces space ON space.school_id=tenant AND space.campus_id=campus AND space.id::text=endpoint.space_id AND space.status='active'
  UNION ALL
  SELECT ancestor.element, ancestor.space_id, parent.id, parent.parent_space_id, parent.kind, ancestor.visited||parent.id
  FROM endpoint_ancestors ancestor JOIN campus_spaces parent ON parent.school_id=tenant AND parent.campus_id=campus AND parent.id=ancestor.parent_space_id AND parent.status='active'
  WHERE NOT parent.id=ANY(ancestor.visited)
 )
 SELECT jsonb_typeof(document->'elements')='array' AND jsonb_array_length(document->'elements')<=2000
 AND (document->'source'->>'image_asset_id' IS NULL OR EXISTS(SELECT 1 FROM campus_scene_images image WHERE image.school_id=tenant AND image.campus_id=campus AND image.id::text=document->'source'->>'image_asset_id'))
 AND NOT EXISTS(SELECT 1 FROM elements WHERE
  (element->>'asset_key' IS NOT NULL AND element->>'asset_key' NOT IN ('generic','academic','library','administration','laboratory','auditorium','residence','sports','dining','parking','gate','boundary_wall','tree_broadleaf','tree_palm','tree_conifer','tree_columnar','shrub','flower_bed','bench','lamp','water','grass','paving','water_point','equipment','desk','chair','computer','meeting_table','cabinet','server_rack','printer','fire_extinguisher','first_aid','toilet','washbasin','door','window','projector','whiteboard'))
  OR(element ? 'depth' AND CASE WHEN jsonb_typeof(element->'depth')='number'
   THEN NOT ((element->>'depth')::numeric > 0 AND (element->>'depth')::numeric <= 10000)
   ELSE true END)
  OR(element ? 'rotation_deg' AND CASE WHEN jsonb_typeof(element->'rotation_deg')='number'
   THEN NOT ((element->>'rotation_deg')::numeric BETWEEN -360 AND 360)
   ELSE true END)
  OR(element ? 'navigation_connector' AND (
   jsonb_typeof(element->'navigation_connector') IS DISTINCT FROM 'object'
   OR element->>'kind' IS DISTINCT FROM 'fixture' OR element->'geometry'->>'type' IS DISTINCT FROM 'point'
   OR coalesce(element->'navigation_connector'->>'kind','') NOT IN ('entrance','stairs','lift')
   OR coalesce(element->'navigation_connector'->>'status','') NOT IN ('open','closed')
   OR jsonb_typeof(element->'navigation_connector'->'accessible') IS DISTINCT FROM 'boolean'
   OR NOT element->'navigation_connector' ?& ARRAY['from_floor_id','to_floor_id']
   OR element->'navigation_connector'->>'to_floor_id' IS NULL
   OR element->>'floor_id' IS DISTINCT FROM element->'navigation_connector'->>'from_floor_id'
   OR element->'navigation_connector'->>'from_floor_id'=element->'navigation_connector'->>'to_floor_id'
   OR (element->'navigation_connector'->>'kind'='entrance') IS DISTINCT FROM (element->'navigation_connector'->>'from_floor_id' IS NULL)
   OR (element->'navigation_connector'->>'kind'='stairs' AND element->'navigation_connector'->'accessible'='true'::jsonb)
   OR NOT EXISTS(SELECT 1 FROM elements parent JOIN campus_spaces building ON building.school_id=tenant AND building.campus_id=campus AND building.status='active' AND building.id::text=parent.element->>'space_id'
    WHERE parent.element->>'id'=elements.element->>'parent_element_id' AND parent.element->>'kind'='building')
  ))
  OR   (element->>'space_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campus_spaces space WHERE space.school_id=tenant AND space.campus_id=campus AND space.id::text=element->>'space_id'))
  OR(element->>'floor_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campus_spaces floor WHERE floor.school_id=tenant AND floor.campus_id=campus AND floor.id::text=element->>'floor_id' AND floor.kind='floor'))
  OR(element ? 'navigation' AND (
   jsonb_typeof(element->'navigation') IS DISTINCT FROM 'object'
   OR element->>'kind' IS DISTINCT FROM 'path' OR element->>'asset_key'='boundary_wall'
   OR element->'navigation'->'walkable' IS DISTINCT FROM 'true'::jsonb
   OR jsonb_typeof(element->'navigation'->'accessible') IS DISTINCT FROM 'boolean'
   OR coalesce(element->'navigation'->>'status','') NOT IN ('open','closed')
   OR NOT element->'navigation' ?& ARRAY['start_space_id','end_space_id']
  )))
 AND NOT EXISTS(SELECT 1 FROM connector_floors connector WHERE NOT EXISTS(
  SELECT 1 FROM connector_ancestors ancestor JOIN elements parent ON parent.element->>'id'=connector.element->>'parent_element_id'
  WHERE ancestor.element=connector.element AND ancestor.floor_id=connector.floor_id AND ancestor.id::text=parent.element->>'space_id'
 ))
 AND NOT EXISTS(SELECT 1 FROM endpoints endpoint WHERE
  NOT EXISTS(SELECT 1 FROM endpoint_ancestors ancestor WHERE ancestor.element=endpoint.element AND ancestor.space_id=endpoint.space_id)
  OR (endpoint.element->>'floor_id' IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM endpoint_ancestors ancestor WHERE ancestor.element=endpoint.element AND ancestor.space_id=endpoint.space_id AND ancestor.id::text=endpoint.element->>'floor_id' AND ancestor.kind='floor'))
  OR (endpoint.element->>'floor_id' IS NULL AND EXISTS(
   SELECT 1 FROM endpoint_ancestors ancestor WHERE ancestor.element=endpoint.element AND ancestor.space_id=endpoint.space_id AND ancestor.kind='floor'))
 )
$$;
