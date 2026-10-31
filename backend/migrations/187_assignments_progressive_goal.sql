-- Register the delivered Assignments outcome in the existing progressive
-- catalogue. Selection prioritises setup; it grants no teaching authority.
INSERT INTO progressive_onboarding_goal_catalog
  (goal_key,label,description,destination,setup_capability,sort_order)
VALUES ('assignments','Assignments','Publish work, receive submissions and give feedback.',
  '/more/setup/capabilities?task=assignments','assignments',35)
ON CONFLICT (goal_key) DO UPDATE SET label=EXCLUDED.label,
  description=EXCLUDED.description,destination=EXCLUDED.destination,
  setup_capability=EXCLUDED.setup_capability,sort_order=EXCLUDED.sort_order,is_active=true;
