-- Walking links remain part of the immutable, selected-world scene document.
-- Exact endpoint places and floors are validated again at the native boundary.
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
  (element->>'space_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campus_spaces space WHERE space.school_id=tenant AND space.campus_id=campus AND space.id::text=element->>'space_id'))
  OR(element->>'floor_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campus_spaces floor WHERE floor.school_id=tenant AND floor.campus_id=campus AND floor.id::text=element->>'floor_id' AND floor.kind='floor'))
  OR(element ? 'navigation' AND (
   jsonb_typeof(element->'navigation') IS DISTINCT FROM 'object'
   OR element->>'kind' IS DISTINCT FROM 'path' OR element->>'asset_key'='boundary_wall'
   OR element->'navigation'->'walkable' IS DISTINCT FROM 'true'::jsonb
   OR jsonb_typeof(element->'navigation'->'accessible') IS DISTINCT FROM 'boolean'
   OR coalesce(element->'navigation'->>'status','') NOT IN ('open','closed')
   OR NOT element->'navigation' ?& ARRAY['start_space_id','end_space_id']
  )))
 AND NOT EXISTS(SELECT 1 FROM endpoints endpoint WHERE
  NOT EXISTS(SELECT 1 FROM endpoint_ancestors ancestor WHERE ancestor.element=endpoint.element AND ancestor.space_id=endpoint.space_id)
  OR (endpoint.element->>'floor_id' IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM endpoint_ancestors ancestor WHERE ancestor.element=endpoint.element AND ancestor.space_id=endpoint.space_id AND ancestor.id::text=endpoint.element->>'floor_id' AND ancestor.kind='floor'))
  OR (endpoint.element->>'floor_id' IS NULL AND EXISTS(
   SELECT 1 FROM endpoint_ancestors ancestor WHERE ancestor.element=endpoint.element AND ancestor.space_id=endpoint.space_id AND ancestor.kind='floor'))
 )
$$;
