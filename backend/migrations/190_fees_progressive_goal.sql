-- A first posted charge is independently useful, not payment or approval authority.
INSERT INTO progressive_onboarding_goal_catalog
  (goal_key,label,description,destination,setup_capability,sort_order)
VALUES ('fees','Fees & receipts','Record charges, follow payments and keep receipts together.',
  '/more/setup/capabilities?task=fees','fees',36)
ON CONFLICT (goal_key) DO UPDATE SET label=EXCLUDED.label,
  description=EXCLUDED.description,destination=EXCLUDED.destination,
  setup_capability=EXCLUDED.setup_capability,sort_order=EXCLUDED.sort_order,is_active=true;
