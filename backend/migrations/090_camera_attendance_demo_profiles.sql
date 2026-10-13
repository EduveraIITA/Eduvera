-- Stage/demo fixture: align the first fourteen Class 7A learner portraits with
-- the supplied camera-attendance classroom image. This changes presentation
-- only; reference enrollment remains an explicit, audited principal action.
WITH demo_profile(roll_number,avatar_url) AS (
  VALUES
    (1,'/assets/demo-camera-attendance/student-01.jpg'),
    (2,'/assets/demo-camera-attendance/student-02.jpg'),
    (3,'/assets/demo-camera-attendance/student-03.jpg'),
    (4,'/assets/demo-camera-attendance/student-04.jpg'),
    (5,'/assets/demo-camera-attendance/student-05.jpg'),
    (6,'/assets/demo-camera-attendance/student-06.jpg'),
    (7,'/assets/demo-camera-attendance/student-07.jpg'),
    (8,'/assets/demo-camera-attendance/student-08.jpg'),
    (9,'/assets/demo-camera-attendance/student-09.jpg'),
    (10,'/assets/demo-camera-attendance/student-10.jpg'),
    (11,'/assets/demo-camera-attendance/student-11.jpg'),
    (12,'/assets/demo-camera-attendance/student-12.jpg'),
    (13,'/assets/demo-camera-attendance/student-13.jpg'),
    (14,'/assets/demo-camera-attendance/student-14.jpg')
), updated AS (
  UPDATE students student
  SET avatar_url=demo_profile.avatar_url
  FROM enrollments enrollment
  JOIN class_sections section ON section.id=enrollment.class_section_id
  JOIN schools school ON school.id=section.school_id
  JOIN demo_profile ON demo_profile.roll_number=enrollment.roll_number
  WHERE student.id=enrollment.student_id
    AND enrollment.is_active
    AND school.code='cis'
    AND section.grade='7'
    AND upper(section.section)='A'
  RETURNING student.user_id,student.avatar_url
)
UPDATE users account
SET avatar_url=updated.avatar_url,updated_at=now()
FROM updated
WHERE account.id=updated.user_id;
