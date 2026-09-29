import unittest
from datetime import date

import generate_school_data as generator


class MediumSchoolGeneratorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dataset, cls.summary = generator.build_dataset(date(2026, 9, 11), 20260911, "OmniDemo@2026")

    def test_complete_student_relationship_graph(self) -> None:
        student_ids = {row[0] for row in self.dataset["students"]}
        guardian_student_ids = {row[2] for row in self.dataset["guardians"]}
        enrollment_student_ids = {row[1] for row in self.dataset["enrollments"]}
        attendance_student_ids = {row[1] for row in self.dataset["attendance"]}
        self.assertEqual(200, len(student_ids))
        self.assertEqual(student_ids, guardian_student_ids)
        self.assertEqual(student_ids, enrollment_student_ids)
        self.assertEqual(student_ids, attendance_student_ids)

    def test_every_student_has_full_two_month_history_and_subject_totals(self) -> None:
        school_days = self.summary["school_days"]
        attendance_counts: dict[str, int] = {}
        subject_counts: dict[str, int] = {}
        for row in self.dataset["attendance"]:
            attendance_counts[row[1]] = attendance_counts.get(row[1], 0) + 1
        for row in self.dataset["subject_attendance"]:
            subject_counts[row[1]] = subject_counts.get(row[1], 0) + 1
        self.assertTrue(all(count == school_days for count in attendance_counts.values()))
        self.assertTrue(all(count == len(generator.SUBJECTS) for count in subject_counts.values()))

    def test_seed_is_non_destructive_and_transactionally_asserted(self) -> None:
        sql = generator.render_sql(self.dataset, self.summary)
        self.assertNotIn("DELETE FROM", sql)
        self.assertNotIn("TRUNCATE", sql)
        self.assertIn("ON CONFLICT", sql)
        self.assertIn("Seed integrity failure", sql)
        self.assertTrue(sql.startswith("BEGIN;"))
        self.assertTrue(sql.rstrip().endswith("COMMIT;"))

    def test_seed_preserves_school_reviewed_guardian_permissions(self) -> None:
        sql = generator.render_sql(self.dataset, self.summary)
        self.assertIn("WHEN guardian_relationships.authority_source='reviewed' THEN guardian_relationships.can_authorize_leave", sql)
        self.assertNotIn("authority_revision=", sql)
        self.assertNotIn("leave_valid_from=", sql)


if __name__ == "__main__":
    unittest.main()
