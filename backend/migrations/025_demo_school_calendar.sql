INSERT INTO school_calendar_days(school_id,date,is_instructional,label)
SELECT id,'2026-10-02'::date,false,'Gandhi Jayanti' FROM schools WHERE code='CIS'
ON CONFLICT(school_id,date) DO UPDATE SET is_instructional=excluded.is_instructional,label=excluded.label,updated_at=now();
