-- Durable private state for the separately deployed photo-inference service.
-- Embeddings, thumbnails and analysis results are encrypted by the service
-- before they enter these bytea fields.
CREATE TABLE photo_inference_meta(key text PRIMARY KEY,value bytea NOT NULL);
CREATE TABLE photo_inference_classes(id varchar(80) PRIMARY KEY,name text NOT NULL,created double precision NOT NULL);
CREATE TABLE photo_inference_students(
  id varchar(80) PRIMARY KEY,class_id varchar(80) NOT NULL REFERENCES photo_inference_classes(id) ON DELETE CASCADE,
  roll_number varchar(80) NOT NULL,name varchar(200) NOT NULL,authorization_record varchar(500) NOT NULL,
  created double precision NOT NULL,UNIQUE(class_id,roll_number));
CREATE TABLE photo_inference_templates(
  id varchar(80) PRIMARY KEY,student_id varchar(80) NOT NULL REFERENCES photo_inference_students(id) ON DELETE CASCADE,
  model_id varchar(160) NOT NULL,embedding bytea NOT NULL,thumbnail bytea NOT NULL,created double precision NOT NULL);
CREATE INDEX photo_inference_template_lookup ON photo_inference_templates(student_id,model_id,created);
CREATE TABLE photo_inference_sessions(
  id varchar(80) PRIMARY KEY,class_id varchar(80) NOT NULL REFERENCES photo_inference_classes(id) ON DELETE CASCADE,
  attendance_date date NOT NULL,period varchar(100) NOT NULL,created double precision NOT NULL,
  version integer NOT NULL DEFAULT 1,confirmed boolean NOT NULL DEFAULT false,result bytea NOT NULL,final_rows bytea);
CREATE INDEX photo_inference_session_lookup ON photo_inference_sessions(class_id,created);
CREATE TABLE photo_inference_audit(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now(),
  action varchar(80) NOT NULL,object_id varchar(100) NOT NULL);
CREATE TABLE photo_inference_multimodal_usage(
  id uuid PRIMARY KEY,model varchar(160) NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX photo_inference_usage_period ON photo_inference_multimodal_usage(created_at);

DO $$ DECLARE table_name text; owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  FOREACH table_name IN ARRAY ARRAY[
    'photo_inference_meta','photo_inference_classes','photo_inference_students','photo_inference_templates',
    'photo_inference_sessions','photo_inference_audit','photo_inference_multimodal_usage'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
    EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,owner_name);
  END LOOP;
END $$;

COMMENT ON TABLE photo_inference_templates IS 'Encrypted face embeddings and cropped reference thumbnails for authorized camera attendance.';
COMMENT ON TABLE photo_inference_multimodal_usage IS 'Non-refundable per-call reservations enforcing the camera-assistance request cap.';
