-- Role-scoped school notices with immutable audience snapshots, explicit
-- response semantics, assisted non-app handling and delivery evidence.
CREATE TABLE school_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  title varchar(180) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 180),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 3 AND 4000),
  response_mode varchar(20) NOT NULL CHECK (response_mode IN ('information','acknowledgement','choice')),
  response_options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(response_options)='array'),
  priority varchar(12) NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent','high','normal')),
  due_at timestamptz,
  status varchar(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz,
  cancelled_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_at timestamptz,
  cancellation_reason varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  CHECK (
    (response_mode='information' AND response_options='[]'::jsonb AND due_at IS NULL) OR
    (response_mode='acknowledgement' AND response_options='[]'::jsonb AND due_at IS NOT NULL) OR
    (response_mode='choice' AND jsonb_array_length(response_options) BETWEEN 2 AND 6 AND due_at IS NOT NULL)
  ),
  CHECK ((status='draft' AND published_at IS NULL) OR (status IN ('published','cancelled') AND published_at IS NOT NULL)),
  CHECK ((status<>'cancelled' AND cancelled_at IS NULL AND cancellation_reason='') OR
    (status='cancelled' AND cancelled_at IS NOT NULL AND char_length(btrim(cancellation_reason))>=3))
);
CREATE INDEX school_notices_school_status_idx ON school_notices(school_id,status,created_at DESC);

CREATE TABLE school_notice_audiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  notice_id uuid NOT NULL,
  audience_kind varchar(24) NOT NULL CHECK (audience_kind IN ('school_staff','school_guardians','class_guardians')),
  class_section_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notice_id,audience_kind,class_section_id),
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,notice_id) REFERENCES school_notices(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,class_section_id) REFERENCES class_sections(school_id,id) ON DELETE RESTRICT,
  CHECK ((audience_kind='class_guardians' AND class_section_id IS NOT NULL) OR
    (audience_kind IN ('school_staff','school_guardians') AND class_section_id IS NULL))
);
CREATE UNIQUE INDEX school_notice_audience_identity_idx
  ON school_notice_audiences(notice_id,audience_kind,COALESCE(class_section_id,'00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE school_notice_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  notice_id uuid NOT NULL,
  recipient_key varchar(180) NOT NULL,
  recipient_role varchar(16) NOT NULL CHECK (recipient_role IN ('guardian','staff','admin')),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  guardian_id uuid REFERENCES parents(id) ON DELETE RESTRICT,
  student_id uuid,
  recipient_name varchar(300) NOT NULL,
  contact_phone varchar(32) NOT NULL DEFAULT '',
  contact_email varchar(254) NOT NULL DEFAULT '',
  opened_at timestamptz,
  responded_at timestamptz,
  response_value varchar(120),
  response_note varchar(1000) NOT NULL DEFAULT '',
  response_channel varchar(16) CHECK (response_channel IN ('app','sms','paper','phone','in_person')),
  response_observed_at timestamptz,
  response_recorded_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notice_id,recipient_key),
  UNIQUE(school_id,id),
  UNIQUE(school_id,notice_id,id),
  FOREIGN KEY(school_id,notice_id) REFERENCES school_notices(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT,
  CHECK ((recipient_role='guardian' AND guardian_id IS NOT NULL AND student_id IS NOT NULL) OR
    (recipient_role IN ('staff','admin') AND guardian_id IS NULL AND student_id IS NULL)),
  CHECK ((responded_at IS NULL AND response_value IS NULL AND response_channel IS NULL AND response_observed_at IS NULL AND response_recorded_by IS NULL) OR
    (responded_at IS NOT NULL AND response_value IS NOT NULL AND response_channel IS NOT NULL AND response_observed_at IS NOT NULL AND response_recorded_by IS NOT NULL))
);
CREATE INDEX school_notice_recipients_user_idx ON school_notice_recipients(user_id,responded_at,created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX school_notice_recipients_guardian_idx ON school_notice_recipients(guardian_id,student_id,responded_at,created_at DESC) WHERE guardian_id IS NOT NULL;

CREATE TABLE school_notice_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  notice_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  channel varchar(16) NOT NULL CHECK (channel IN ('app','sms','paper','phone','in_person')),
  status varchar(16) NOT NULL CHECK (status IN ('queued','attempted','delivered','failed','cancelled')),
  note varchar(500) NOT NULL DEFAULT '',
  provider_reference varchar(180) NOT NULL DEFAULT '',
  attempted_at timestamptz NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,notice_id) REFERENCES school_notices(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,notice_id,recipient_id)
    REFERENCES school_notice_recipients(school_id,notice_id,id) ON DELETE CASCADE
);
CREATE INDEX school_notice_delivery_recipient_idx ON school_notice_delivery_attempts(recipient_id,created_at DESC);

CREATE TABLE school_notice_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  notice_id uuid NOT NULL,
  recipient_id uuid,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(24) NOT NULL CHECK (action IN ('draft_created','draft_updated','published','cancelled','opened','responded','assisted_response','delivery_recorded')),
  from_status varchar(20),
  to_status varchar(20) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,notice_id) REFERENCES school_notices(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,notice_id,recipient_id)
    REFERENCES school_notice_recipients(school_id,notice_id,id) ON DELETE CASCADE
);
CREATE INDEX school_notice_audits_notice_idx ON school_notice_audits(notice_id,created_at,id);

CREATE TABLE school_notice_commands (
  school_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL,
  operation varchar(32) NOT NULL,
  notice_id uuid NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,idempotency_key),
  FOREIGN KEY(school_id,notice_id) REFERENCES school_notices(school_id,id) ON DELETE CASCADE
);

DO $$
DECLARE application_owner text; table_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner FROM pg_class WHERE oid='public.students'::regclass;
  FOREACH table_name IN ARRAY ARRAY[
    'school_notices','school_notice_audiences','school_notice_recipients',
    'school_notice_delivery_attempts','school_notice_audits','school_notice_commands'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon',table_name); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated',table_name); END IF;
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I',table_name,application_owner);
  END LOOP;
END $$;
