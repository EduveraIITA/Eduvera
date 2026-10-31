-- A cumulative serving pointer must identify this exact source's latest signed
-- count, never another source's equal-valued count or an ordinary menu receipt.
CREATE FUNCTION dining_count_pointer_valid(tenant uuid,session uuid,receipt_id uuid,total integer,source_revision integer) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT CASE WHEN receipt_id IS NULL THEN total=0 AND NOT EXISTS(SELECT 1 FROM dining_session_receipts receipt WHERE receipt.school_id=tenant AND receipt.session_id=session AND receipt.action IN('counted','count_corrected') AND receipt.revision<=source_revision)
 ELSE EXISTS(SELECT 1 FROM dining_session_receipts receipt WHERE receipt.school_id=tenant AND receipt.session_id=session AND receipt.id=receipt_id AND receipt.action IN('counted','count_corrected') AND receipt.count_total=total AND receipt.observed_at IS NOT NULL AND receipt.observed_at<=receipt.recorded_at AND receipt.revision<=source_revision AND NOT EXISTS(SELECT 1 FROM dining_session_receipts later WHERE later.school_id=tenant AND later.session_id=session AND later.action IN('counted','count_corrected') AND later.revision>receipt.revision AND later.revision<=source_revision)) END
$$;
CREATE FUNCTION dining_count_pointer_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT coalesce(dining_count_pointer_valid(NEW.school_id,NEW.id,NEW.current_count_receipt_id,NEW.count_total,NEW.revision),false) THEN RAISE EXCEPTION 'A cumulative dining count requires its exact latest source observation.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER dining_count_pointer AFTER INSERT OR UPDATE ON dining_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dining_count_pointer_guard();
CREATE FUNCTION dining_count_receipt_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE previous dining_session_receipts;current_mode text;BEGIN
 SELECT * INTO previous FROM dining_session_receipts receipt WHERE receipt.school_id=NEW.school_id AND receipt.session_id=NEW.session_id AND receipt.action IN('counted','count_corrected') AND receipt.revision<NEW.revision ORDER BY receipt.revision DESC LIMIT 1;
 SELECT operations_mode INTO current_mode FROM dining_sessions WHERE school_id=NEW.school_id AND id=NEW.session_id;
 IF NEW.action IN('counted','count_corrected') THEN
  IF current_mode<>'native' OR NEW.observed_at IS NULL OR NEW.observed_at>NEW.recorded_at THEN RAISE EXCEPTION 'Serving counts require explicit native observation provenance.' USING ERRCODE='23514';END IF;
  IF NEW.action='counted' AND(NEW.state<>'open' OR NEW.count_total<coalesce(previous.count_total,0) OR NEW.supersedes_receipt_id IS NOT NULL OR previous.observed_at IS NOT NULL AND NEW.observed_at<previous.observed_at) THEN RAISE EXCEPTION 'Cumulative counts cannot erase or add an older report.' USING ERRCODE='23514';END IF;
  IF NEW.action='count_corrected' AND(NEW.state NOT IN('open','paused','ended') OR previous.id IS NULL OR NEW.supersedes_receipt_id IS DISTINCT FROM previous.id OR length(btrim(NEW.note))<3) THEN RAISE EXCEPTION 'Count corrections require the exact preceding observation and a reason.' USING ERRCODE='23514';END IF;
 ELSE
  IF NEW.count_total<>coalesce(previous.count_total,0) OR NEW.observed_at IS NOT NULL OR NEW.supersedes_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'Menu and lifecycle actions cannot rewrite serving observations.' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER dining_count_receipt BEFORE INSERT ON dining_session_receipts FOR EACH ROW EXECUTE FUNCTION dining_count_receipt_guard();
