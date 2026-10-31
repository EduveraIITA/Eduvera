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
        self.assertEqual(200, len(student_ids))
        self.assertEqual(student_ids, guardian_student_ids)
        self.assertEqual(student_ids, enrollment_student_ids)
        self.assertEqual([], self.dataset["attendance"])

    def test_bootstrap_leaves_participation_unknown_and_subject_counters_empty(self) -> None:
        subject_counts: dict[str, int] = {}
        for row in self.dataset["subject_attendance"]:
            subject_counts[row[1]] = subject_counts.get(row[1], 0) + 1
        self.assertTrue(all(count == len(generator.SUBJECTS) for count in subject_counts.values()))
        self.assertTrue(all(row[4:] == (0, 0, 0) for row in self.dataset["subject_attendance"]))
        self.assertEqual(0, self.summary["attendance_records"])
        self.assertEqual(200, self.summary["relationship_invariants"]["students_without_attendance_history"])
        self.assertIn("owning Attendance services", self.summary["attendance_seed_contract"])
        self.assertFalse(any(row[2] == "attendance" for row in self.dataset["notifications"]))

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

    def test_campus_events_cover_independent_operational_requirements(self) -> None:
        annual_id = generator.deterministic_id("campus-event-annual-function-2026")
        picnic_id = generator.deterministic_id("campus-event-class-7a-picnic-2026")
        class_test_id = generator.deterministic_id("campus-event-class-7a-mathematics-test-2026")
        events = {row[0]: row for row in self.dataset["campus_events"]}

        self.assertEqual({annual_id, picnic_id, class_test_id}, set(events))
        self.assertEqual("completed", events[annual_id][3])
        self.assertEqual("published", events[picnic_id][3])
        self.assertEqual("published", events[class_test_id][3])
        self.assertTrue(all(row[14] == "none" for row in events.values()))
        self.assertEqual(("mandatory", False, False, False), events[annual_id][10:14])
        self.assertEqual(("optional", True, True, True), events[picnic_id][10:14])
        self.assertEqual(("mandatory", False, False, False), events[class_test_id][10:14])
        self.assertEqual((None, None, "INR"), events[annual_id][-4:-1])
        self.assertEqual((185000, "2026-10-03", "INR"), events[picnic_id][-4:-1])
        self.assertEqual((None, None, "INR"), events[class_test_id][-4:-1])
        self.assertEqual(generator.deterministic_id("subject-mat"), events[class_test_id][-1])

        annual_participants = [row for row in self.dataset["campus_event_participants"] if row[1] == annual_id]
        picnic_participants = [row for row in self.dataset["campus_event_participants"] if row[1] == picnic_id]
        class_test_participants = [row for row in self.dataset["campus_event_participants"] if row[1] == class_test_id]
        self.assertEqual(200, len(annual_participants))
        self.assertEqual(25, len(picnic_participants))
        self.assertEqual(25, len(class_test_participants))
        self.assertTrue(all(row[3] == "mandatory" and row[4] == "pending" and row[5] is None for row in annual_participants))
        self.assertTrue(all(row[3] == "optional" for row in picnic_participants))
        self.assertTrue(all(row[3] == "mandatory" and row[5] is None for row in class_test_participants))
        self.assertTrue(all((row[4] == "accepted") == (row[5] is not None) for row in picnic_participants))
        accepted_picnic_students = {row[2] for row in picnic_participants if row[4] == "accepted"}
        picnic_session_rosters = [
            {row[3] for row in self.dataset["campus_event_session_participants"] if row[1] == picnic_id and row[2] == session[0]}
            for session in self.dataset["campus_event_sessions"] if session[2] == picnic_id
        ]
        self.assertEqual(16, len(accepted_picnic_students))
        self.assertEqual(3, len(picnic_session_rosters))
        self.assertTrue(all(roster == accepted_picnic_students for roster in picnic_session_rosters))
        participant_status = {
            (row[1], row[2]): row[4] for row in self.dataset["campus_event_participants"]
        }
        self.assertTrue(all(
            participant_status[(row[1], row[3])] == "accepted"
            for row in self.dataset["campus_event_session_participants"] if row[4] == "optional"
        ))
        self.assertGreater(len(self.dataset["campus_event_fee_invoices"]), 0)
        self.assertGreater(len(self.dataset["campus_event_fee_payments"]), 0)
        self.assertLess(len(self.dataset["campus_event_fee_payments"]), len(self.dataset["campus_event_fee_invoices"]))
        self.assertGreater(len(self.dataset["campus_event_consents"]), 0)
        self.assertGreater(len(self.dataset["campus_event_checklist_completions"]), 0)
        self.assertTrue(all(row[4] for row in self.dataset["campus_event_checklist_items"]))

    def test_event_rosters_do_not_fabricate_reports_or_final_registers(self) -> None:
        self.assertEqual([], self.dataset["campus_event_attendance"])
        self.assertEqual([], self.dataset["campus_event_attendance_revisions"])
        self.assertEqual(0, self.summary["campus_event_attendance_records"])
        self.assertTrue(all(row[9] == "open" for row in self.dataset["campus_event_sessions"]))

    def test_event_seed_is_idempotent_without_rewriting_review_activity(self) -> None:
        sql = generator.render_sql(self.dataset, self.summary)
        self.assertIn("INSERT INTO campus_events", sql)
        self.assertIn("INSERT INTO campus_event_consents", sql)
        self.assertIn("INSERT INTO campus_event_session_participants", sql)
        for table in ["attendance_records", "attendance_record_revisions", "attendance_session_records", "campus_event_attendance_records",
                      "campus_event_attendance_revisions", "attendance_records_legacy_source", "campus_event_attendance_records_legacy_source",
                      "activity_attendance_entries", "activity_attendance_entry_revisions", "activity_attendance_evidence"]:
            self.assertNotIn(f"INSERT INTO {table}", sql)
            self.assertNotIn(f"UPDATE {table}", sql)
            self.assertNotIn(f"ALTER TABLE {table}", sql)
        self.assertNotIn("DISABLE TRIGGER", sql)
        self.assertNotIn("classes_held=excluded", sql)
        self.assertIn("INSERT INTO fee_invoices", sql)
        self.assertIn("INSERT INTO fee_payments", sql)
        self.assertIn("campus event attendance must remain separate from academic attendance", sql)
        event_insert = sql[sql.index("INSERT INTO campus_events"):sql.index("INSERT INTO campus_event_class_sections")]
        self.assertIn("ON CONFLICT DO NOTHING", event_insert)
        self.assertNotIn("DO UPDATE", event_insert)

    def test_class_test_matches_teacher_class_subject_and_timetable(self) -> None:
        class_test_id = generator.deterministic_id("campus-event-class-7a-mathematics-test-2026")
        class_7a_id = generator.deterministic_id("class-7a")
        mathematics_id = generator.deterministic_id("subject-mat")
        kavita_id = generator.deterministic_id("user-kavita")
        event = next(row for row in self.dataset["campus_events"] if row[0] == class_test_id)

        self.assertEqual("class_test", event[2])
        self.assertEqual(mathematics_id, event[-1])
        self.assertIn((event[1], class_test_id, class_7a_id), self.dataset["campus_event_class_sections"])
        self.assertTrue(any(
            row[2] == class_7a_id and row[3] == kavita_id and row[4] == "subject_teacher" and row[5] == mathematics_id
            for row in self.dataset["class_staff_assignments"]
        ))
        self.assertTrue(any(
            row[1] == class_7a_id and row[3] == mathematics_id and row[4] == 4
            and row[6] == "09:00" and row[11] == kavita_id
            for row in self.dataset["timetable"]
        ))


if __name__ == "__main__":
    unittest.main()
