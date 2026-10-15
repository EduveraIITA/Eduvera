ALTER TABLE gate_visitors ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE gate_visitors ADD COLUMN request_id uuid;
ALTER TABLE gate_visitors ADD COLUMN decided_at timestamptz;
ALTER TABLE gate_visitors ADD COLUMN expires_at timestamptz NOT NULL DEFAULT (now()+interval '8 hours');
UPDATE gate_visitors SET expires_at=created_at+interval '8 hours';
CREATE UNIQUE INDEX gate_visitors_request_idx ON gate_visitors(school_id,request_id) WHERE request_id IS NOT NULL;
CREATE INDEX gate_visitors_host_pending_idx ON gate_visitors(host_user_id,created_at,id) WHERE state='pending';

-- A frozen audience is only a routing hint. Recheck the actual visitor and
-- current host/admin/gate relationship for both replay and notification reads.
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid)
  RENAME TO event_user_is_authorized_before_gate_visitors;
CREATE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT CASE WHEN event_name='gate.visitor.updated' THEN EXISTS (
  SELECT 1 FROM gate_visitors visitor
  JOIN school_memberships member ON member.school_id=visitor.school_id
   AND member.user_id=candidate_user_id AND member.is_active AND member.role IN ('staff','admin')
  JOIN users account ON account.id=member.user_id AND account.is_active
  WHERE visitor.school_id=event_school_id AND visitor.id::text=event_payload->>'visitor_id'
   AND (visitor.host_user_id=candidate_user_id OR member.role='admin'
     OR staff_has_resource_permission(visitor.school_id,candidate_user_id,'gate.manage','institution',visitor.school_id))
   AND (event_payload->>'action'<>'requested' OR (visitor.state='pending' AND visitor.expires_at>now()))
 ) ELSE event_user_is_authorized_before_gate_visitors(event_school_id,event_name,event_payload,candidate_user_id) END
$$;
REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC;
DO $$ DECLARE runtime_owner text; BEGIN
 SELECT pg_get_userbyid(relowner) INTO runtime_owner FROM pg_class WHERE oid='gate_visitors'::regclass;
 EXECUTE format('ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',runtime_owner);
END $$;
