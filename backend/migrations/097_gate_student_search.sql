-- pg_trgm is already required by institution-directory search (053).
-- Match the literal case-insensitive name/admission expressions used by gate search.
CREATE INDEX school_people_gate_name_trgm_idx
  ON school_people USING gin (lower(first_name || ' ' || last_name) gin_trgm_ops);
CREATE INDEX students_gate_admission_trgm_idx
  ON students USING gin (lower(admission_number) gin_trgm_ops);
