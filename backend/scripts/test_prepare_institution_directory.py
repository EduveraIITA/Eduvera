import unittest
from prepare_institution_directory import school, higher_education, validate


class DirectoryNormalizationTests(unittest.TestCase):
    def test_leading_zero_and_unverified_provenance(self):
        row = school(dict(udise_school_code="3070609601", school_name=" School ", state_name="Punjab", district_name="Ludhiana", village_name="Village"), "fixture")
        self.assertEqual(row["source_code"], "03070609601")
        self.assertEqual(row["is_verified"], "false")
        self.assertEqual(row["address"], "")

    def test_alphanumeric_school_code_is_not_invented(self):
        with self.assertRaisesRegex(ValueError, "invalid_udise_code"):
            school(dict(udise_school_code="070501ND201"), "fixture")

    def test_aishe_type_comes_from_official_code(self):
        for prefix, kind in [("C", "college"), ("U", "university"), ("S", "standalone")]:
            row = higher_education(dict(aishe_code=prefix+"-0012", name="Institute", state="Delhi"), "fixture")
            self.assertEqual(validate(row)["institution_type"], kind)
        with self.assertRaises(ValueError):
            higher_education(dict(aishe_code="R-12"), "fixture")

    def test_long_names_are_not_silently_truncated(self):
        row = higher_education(dict(aishe_code="C-1", name="a"*181, state="Delhi"), "fixture")
        with self.assertRaisesRegex(ValueError, "name_outside"):
            validate(row)


if __name__ == "__main__":
    unittest.main()
