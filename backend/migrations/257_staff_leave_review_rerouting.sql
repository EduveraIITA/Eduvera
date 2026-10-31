-- Explicit source-owned review transfer. Original submissions remain immutable.
ALTER TABLE staff_leave_commands DROP CONSTRAINT staff_leave_commands_command_type_check;
ALTER TABLE staff_leave_commands ADD CONSTRAINT staff_leave_commands_command_type_check
  CHECK(command_type IN ('submit','decide','withdraw','reroute'));
ALTER TABLE staff_leave_request_audits DROP CONSTRAINT staff_leave_request_audits_action_check;
ALTER TABLE staff_leave_request_audits ADD CONSTRAINT staff_leave_request_audits_action_check
  CHECK(action IN ('submitted','approved','rejected','withdrawn','rerouted'));
CREATE INDEX staff_leave_commands_current_route_idx
  ON staff_leave_commands(school_id,target_request_id,((result->>'revision')::integer) DESC)
  WHERE command_type IN ('submit','reroute');
