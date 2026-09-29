CREATE UNIQUE INDEX IF NOT EXISTS day_plan_subject_identity_idx ON subjects(school_id,id);
ALTER TABLE day_plan_periods ADD COLUMN subject_id uuid;
ALTER TABLE day_plan_periods ADD CONSTRAINT day_plan_subject_fk FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id) ON DELETE RESTRICT;
CREATE INDEX day_plan_periods_subject_idx ON day_plan_periods(school_id,subject_id);
UPDATE day_plan_periods p SET subject_id=slot.subject_id FROM day_plans d,timetable_slots slot,subjects subject
WHERE p.plan_id=d.id AND slot.class_section_id=d.class_section_id AND slot.term_id=d.term_id
  AND slot.weekday=extract(isodow FROM d.date) AND slot.period_number=p.period_number
  AND subject.id=slot.subject_id AND subject.school_id=p.school_id AND p.title=subject.name;
CREATE OR REPLACE FUNCTION effective_school_schedule(p_school uuid,p_date date)
RETURNS TABLE(id uuid,class_section_id uuid,term_id uuid,weekday smallint,period_number smallint,
  starts_at time,ends_at time,title text,slot_type varchar,room varchar,teacher_user_id uuid,
  teacher_designation text,subject_id uuid,materials text[],cancelled boolean,
  day_plan_id uuid,plan_version integer,notice text,coverage_status text)
LANGUAGE sql STABLE AS $$
  SELECT p.id,d.class_section_id,d.term_id,extract(isodow FROM p_date)::smallint,p.period_number,
    p.starts_at,p.ends_at,p.title::text,p.slot_type,p.room,m.user_id,'Teacher'::text,p.subject_id,
    p.materials,p.cancelled,d.id,d.published_version,v.notice::text,p.coverage_status
  FROM day_plans d JOIN day_plan_versions v ON v.plan_id=d.id AND v.version=d.published_version
  JOIN day_plan_periods p ON p.plan_id=v.plan_id AND p.version=v.version
  LEFT JOIN school_memberships m ON m.id=p.teacher_membership_id
  WHERE d.school_id=p_school AND d.date=p_date
  UNION ALL
  SELECT s.id,s.class_section_id,s.term_id,s.weekday,s.period_number,s.starts_at,s.ends_at,
    COALESCE(subject.name,s.title)::text,s.slot_type,s.room,s.teacher_user_id,s.teacher_designation::text,
    s.subject_id,'{}'::text[],false,NULL::uuid,NULL::integer,''::text,
    CASE WHEN s.teacher_user_id IS NULL AND s.slot_type='class' THEN 'unassigned' ELSE 'not_required' END
  FROM timetable_slots s JOIN class_sections c ON c.id=s.class_section_id
  JOIN academic_terms t ON t.id=s.term_id AND t.school_id=c.school_id
  LEFT JOIN subjects subject ON subject.id=s.subject_id
  WHERE c.school_id=p_school AND s.weekday=extract(isodow FROM p_date)
    AND p_date BETWEEN t.starts_on AND t.ends_on
    AND NOT EXISTS(SELECT 1 FROM day_plans d WHERE d.class_section_id=c.id AND d.date=p_date AND d.published_version IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM school_calendar_days cal WHERE cal.school_id=p_school AND cal.date=p_date AND NOT cal.is_instructional)
$$;
