import type { ColumnType } from "kysely";
import type { CampusDateDto } from "./campus-dates.contracts.js";
type Timestamp = ColumnType<Date, Date | string, Date | string>;
export interface CampusDateTable { id: string; school_id: string; title: string; description: string; starts_on: string; ends_on: string;
  category_label: string; academic_term_id: string | null; provenance: ColumnType<CampusDateDto["provenance"], unknown, unknown>;
  state: "published" | "cancelled"; revision: number; cancellation_reason: string | null;
  created_by: string; updated_by: string; created_at: Timestamp; updated_at: Timestamp; }
export interface CampusDateRevisionTable { school_id: string; date_id: string; revision: number; action: "published" | "corrected" | "cancelled";
  command_id: string; actor_person_id: string; actor_user_id: string; reason: string; snapshot: ColumnType<CampusDateDto, unknown, never>; recorded_at: Timestamp; }
