-- Extend the explicit notification-to-attention contract. Existing and
-- untyped bell rows remain excluded: every eligible row must still be opted
-- in by a producer with a durable source id and monotonic source revision.
ALTER TABLE notifications
  DROP CONSTRAINT notifications_typed_attention_contract_ck,
  ADD CONSTRAINT notifications_typed_attention_contract_ck CHECK (
    (
      NOT attention_eligible
      AND attention_school_id IS NULL
      AND attention_student_id IS NULL
      AND attention_class_section_id IS NULL
      AND attention_portal IS NULL
      AND attention_module IS NULL
      AND attention_source_kind IS NULL
      AND attention_source_id IS NULL
      AND attention_source_revision IS NULL
      AND attention_topic_key IS NULL
    ) OR (
      attention_eligible
      AND attention_school_id IS NOT NULL
      AND attention_portal IN ('parent','teacher','principal')
      AND attention_module IN (
        'leave','results','calendar','timetable','attendance','events',
        'fees','safeguarding','policies','departure'
      )
      AND attention_source_kind IN (
        'student_leave_decision','staff_leave_decision',
        'assessment_publication','report_publication','day_plan_publication',
        'timetable_publication','calendar_change','attendance_outcome',
        'event_cancellation','event_withdrawal','event_refund',
        'fee_review_decision','guardian_leave_authority',
        'restricted_care_update','policy_publication',
        'departure_request_decision','transport_trip_cancellation',
        'transport_rider_exception','departure_handover_exception'
      )
      AND attention_source_id IS NOT NULL
      AND attention_source_revision >= 1
      AND length(trim(attention_topic_key)) BETWEEN 1 AND 255
      AND CASE attention_source_kind
        WHEN 'student_leave_decision' THEN attention_portal='parent' AND attention_module='leave'
        WHEN 'staff_leave_decision' THEN attention_portal='teacher' AND attention_module='leave'
        WHEN 'assessment_publication' THEN attention_portal='parent' AND attention_module='results'
        WHEN 'report_publication' THEN attention_portal='parent' AND attention_module='results'
        WHEN 'day_plan_publication' THEN attention_portal IN ('parent','teacher','principal') AND attention_module='timetable'
        WHEN 'timetable_publication' THEN attention_portal IN ('parent','teacher','principal') AND attention_module='timetable'
        WHEN 'calendar_change' THEN attention_portal IN ('parent','teacher','principal') AND attention_module='calendar'
        WHEN 'attendance_outcome' THEN attention_portal='parent' AND attention_module='attendance' AND attention_student_id IS NOT NULL
        WHEN 'event_cancellation' THEN attention_portal='parent' AND attention_module='events' AND attention_student_id IS NOT NULL
        WHEN 'event_withdrawal' THEN attention_portal='parent' AND attention_module='events' AND attention_student_id IS NOT NULL
        WHEN 'event_refund' THEN attention_portal='parent' AND attention_module='events' AND attention_student_id IS NOT NULL
        WHEN 'fee_review_decision' THEN attention_portal='parent' AND attention_module='fees' AND attention_student_id IS NOT NULL
        WHEN 'guardian_leave_authority' THEN attention_portal='parent' AND attention_module='leave' AND attention_student_id IS NOT NULL
        WHEN 'restricted_care_update' THEN attention_portal IN ('teacher','principal') AND attention_module='safeguarding' AND attention_student_id IS NULL
        WHEN 'policy_publication' THEN attention_portal IN ('parent','teacher') AND attention_module='policies' AND attention_student_id IS NULL
        WHEN 'departure_request_decision' THEN attention_portal='parent' AND attention_module='departure' AND attention_student_id IS NOT NULL
        WHEN 'transport_trip_cancellation' THEN attention_portal='parent' AND attention_module='departure' AND attention_student_id IS NOT NULL
        WHEN 'transport_rider_exception' THEN attention_portal='parent' AND attention_module='departure' AND attention_student_id IS NOT NULL
        WHEN 'departure_handover_exception' THEN attention_portal='parent' AND attention_module='departure' AND attention_student_id IS NOT NULL
        ELSE false
      END
    )
  );
