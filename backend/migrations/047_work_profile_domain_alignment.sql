-- Complete the controlled capability catalogue for domain-owned work that was
-- already present before calculated access. Resource and workflow checks remain
-- in the owning services.
UPDATE staff_responsibility_types
SET capability_permissions = (
  SELECT array_agg(DISTINCT permission ORDER BY permission)
  FROM unnest(capability_permissions || ARRAY['dayplans.respond','events.view','events.manage']::text[]) permission
)
WHERE code='subject_teacher';
