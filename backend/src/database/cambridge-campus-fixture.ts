import { createHash } from "node:crypto";

/**
 * Development-only physical-campus fixture for the wholly synthetic Cambridge
 * school.  It is deliberately declarative so production topology and runtime
 * behaviour never acquire Cambridge-specific defaults.
 */
export const CAMBRIDGE_CAMPUS_FIXTURE_VERSION = "cambridge-campus-replica.v1";

export type CambridgeSpaceKind =
  | "building"
  | "wing"
  | "floor"
  | "classroom"
  | "laboratory"
  | "library"
  | "office"
  | "auditorium"
  | "sports_area"
  | "workshop"
  | "staff_room"
  | "gate"
  | "outdoor_area"
  | "virtual"
  | "other";

export interface CambridgeSpaceFixture {
  code: string;
  name: string;
  kind: CambridgeSpaceKind;
  parent_code: string | null;
  capacity: number | null;
  accessible: boolean;
  bookable: boolean;
  zone: "academic" | "administration" | "community" | "arrival" | "outdoor";
  purpose: string;
  map: { x: number; y: number; width: number; height: number };
  aliases?: string[];
}

export interface CambridgeOperationalStaffFixture {
  code: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  designation: string;
  department: string;
  employment_type: "full_time" | "part_time" | "contract";
  joined_on: string;
  home_space_code: string;
  responsibility_code: "school_duty" | "safety_officer" | "transport_attendant";
  duty_label: string;
  duty_location: string;
}

/** Stable IDs allow a targeted fixture upgrade without a full school reset. */
export function cambridgeFixtureId(key: string): string {
  const digest = createHash("sha256")
    .update(`thatcampus:${CAMBRIDGE_CAMPUS_FIXTURE_VERSION}:${key}`)
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

/**
 * Coordinates are a bounded schematic footprint, not a surveyed floor plan.
 * Child coordinates are local hints for future drill-down views; physical
 * capacity and hierarchy remain relational columns.
 */
export const CAMBRIDGE_SPACES: readonly CambridgeSpaceFixture[] = [
  { code: "BLDG-ACADEMIC", name: "Academic Block", kind: "building", parent_code: null, capacity: null, accessible: true, bookable: false, zone: "academic", purpose: "Classrooms and specialist learning", map: { x: 180, y: 80, width: 430, height: 390 } },
  { code: "FLR-200", name: "Rooms 200–299", kind: "floor", parent_code: "BLDG-ACADEMIC", capacity: null, accessible: true, bookable: false, zone: "academic", purpose: "Middle school learning floor", map: { x: 195, y: 95, width: 400, height: 105 } },
  { code: "ROOM-201", name: "Classroom 201", kind: "classroom", parent_code: "FLR-200", capacity: 40, accessible: true, bookable: true, zone: "academic", purpose: "Class 6A home classroom", map: { x: 205, y: 110, width: 88, height: 72 }, aliases: ["Room 201"] },
  { code: "ROOM-202", name: "Classroom 202", kind: "classroom", parent_code: "FLR-200", capacity: 40, accessible: true, bookable: true, zone: "academic", purpose: "Class 6B home classroom", map: { x: 303, y: 110, width: 88, height: 72 }, aliases: ["Room 202"] },
  { code: "ROOM-204", name: "Classroom 204", kind: "classroom", parent_code: "FLR-200", capacity: 40, accessible: true, bookable: true, zone: "academic", purpose: "Class 7A home classroom", map: { x: 401, y: 110, width: 88, height: 72 }, aliases: ["Room 204"] },
  { code: "ROOM-205", name: "Classroom 205", kind: "classroom", parent_code: "FLR-200", capacity: 40, accessible: true, bookable: true, zone: "academic", purpose: "Class 7B home classroom", map: { x: 499, y: 110, width: 88, height: 72 }, aliases: ["Room 205"] },
  { code: "FLR-300", name: "Rooms 300–399", kind: "floor", parent_code: "BLDG-ACADEMIC", capacity: null, accessible: true, bookable: false, zone: "academic", purpose: "Senior and specialist learning floor", map: { x: 195, y: 215, width: 400, height: 105 } },
  { code: "ROOM-301", name: "Classroom 301", kind: "classroom", parent_code: "FLR-300", capacity: 40, accessible: true, bookable: true, zone: "academic", purpose: "Class 8A home classroom", map: { x: 205, y: 230, width: 88, height: 72 }, aliases: ["Room 301"] },
  { code: "ROOM-302", name: "Classroom 302", kind: "classroom", parent_code: "FLR-300", capacity: 40, accessible: true, bookable: true, zone: "academic", purpose: "Class 8B home classroom", map: { x: 303, y: 230, width: 88, height: 72 }, aliases: ["Room 302"] },
  { code: "LAB-SCI", name: "Integrated Science Laboratory", kind: "laboratory", parent_code: "FLR-300", capacity: 32, accessible: true, bookable: true, zone: "academic", purpose: "Practical science teaching", map: { x: 401, y: 230, width: 88, height: 72 } },
  { code: "LAB-COMPUTER", name: "Computer Laboratory", kind: "laboratory", parent_code: "FLR-300", capacity: 30, accessible: true, bookable: true, zone: "academic", purpose: "Computing and digital learning", map: { x: 499, y: 230, width: 88, height: 72 } },
  { code: "FLR-400", name: "Rooms 400–499", kind: "floor", parent_code: "BLDG-ACADEMIC", capacity: null, accessible: true, bookable: false, zone: "academic", purpose: "Senior school and creative learning floor", map: { x: 195, y: 335, width: 400, height: 105 } },
  { code: "ROOM-401", name: "Classroom 401", kind: "classroom", parent_code: "FLR-400", capacity: 40, accessible: true, bookable: true, zone: "academic", purpose: "Class 9A home classroom", map: { x: 205, y: 350, width: 88, height: 72 }, aliases: ["Room 401"] },
  { code: "ROOM-402", name: "Classroom 402", kind: "classroom", parent_code: "FLR-400", capacity: 40, accessible: true, bookable: true, zone: "academic", purpose: "Class 9B home classroom", map: { x: 303, y: 350, width: 88, height: 72 }, aliases: ["Room 402"] },
  { code: "STUDIO-ART", name: "Art & Design Studio", kind: "workshop", parent_code: "FLR-400", capacity: 28, accessible: true, bookable: true, zone: "academic", purpose: "Visual art and design practice", map: { x: 401, y: 350, width: 88, height: 72 } },
  { code: "STAFF-ROOM", name: "Faculty Workroom", kind: "staff_room", parent_code: "FLR-400", capacity: 28, accessible: true, bookable: false, zone: "academic", purpose: "Teacher planning and staff coordination", map: { x: 499, y: 350, width: 88, height: 72 } },

  { code: "BLDG-ADMIN", name: "Administration & Student Services", kind: "building", parent_code: null, capacity: null, accessible: true, bookable: false, zone: "administration", purpose: "Administration, care and family services", map: { x: 40, y: 150, width: 115, height: 275 } },
  { code: "FLR-ADMIN", name: "Student Services Floor", kind: "floor", parent_code: "BLDG-ADMIN", capacity: null, accessible: true, bookable: false, zone: "administration", purpose: "Public-facing and student-support services", map: { x: 50, y: 165, width: 95, height: 245 } },
  { code: "RECEPTION", name: "Reception & Visitor Desk", kind: "office", parent_code: "FLR-ADMIN", capacity: 12, accessible: true, bookable: false, zone: "administration", purpose: "Visitor registration and front office", map: { x: 58, y: 178, width: 78, height: 36 } },
  { code: "SCHOOL-OFFICE", name: "School Office", kind: "office", parent_code: "FLR-ADMIN", capacity: 16, accessible: true, bookable: false, zone: "administration", purpose: "Records and school administration", map: { x: 58, y: 222, width: 78, height: 36 } },
  { code: "PRINCIPAL-OFFICE", name: "Principal's Office", kind: "office", parent_code: "FLR-ADMIN", capacity: 8, accessible: true, bookable: false, zone: "administration", purpose: "School leadership and reviewed meetings", map: { x: 58, y: 266, width: 78, height: 36 } },
  { code: "WELLBEING", name: "Counselling & Wellbeing Room", kind: "office", parent_code: "FLR-ADMIN", capacity: 6, accessible: true, bookable: false, zone: "administration", purpose: "Private student wellbeing support", map: { x: 58, y: 310, width: 78, height: 36 } },
  { code: "INFIRMARY", name: "Health Room & Infirmary", kind: "other", parent_code: "FLR-ADMIN", capacity: 8, accessible: true, bookable: false, zone: "administration", purpose: "First aid and short-term supervised rest", map: { x: 58, y: 354, width: 78, height: 44 } },

  { code: "BLDG-COMMUNITY", name: "Community & Activity Centre", kind: "building", parent_code: null, capacity: null, accessible: true, bookable: false, zone: "community", purpose: "Library, dining, performances and community activity", map: { x: 635, y: 125, width: 150, height: 330 } },
  { code: "FLR-COMMUNITY", name: "Community Floor", kind: "floor", parent_code: "BLDG-COMMUNITY", capacity: null, accessible: true, bookable: false, zone: "community", purpose: "Shared learning and community facilities", map: { x: 648, y: 140, width: 124, height: 300 } },
  { code: "LIBRARY", name: "Library & Learning Commons", kind: "library", parent_code: "FLR-COMMUNITY", capacity: 80, accessible: true, bookable: true, zone: "community", purpose: "Reading, research and quiet study", map: { x: 658, y: 155, width: 104, height: 60 } },
  { code: "AUDITORIUM", name: "Multipurpose Auditorium", kind: "auditorium", parent_code: "FLR-COMMUNITY", capacity: 320, accessible: true, bookable: true, zone: "community", purpose: "Assemblies, performances and examinations", map: { x: 658, y: 225, width: 104, height: 92 } },
  { code: "CANTEEN", name: "Dining Hall & Canteen", kind: "other", parent_code: "FLR-COMMUNITY", capacity: 140, accessible: true, bookable: false, zone: "community", purpose: "Supervised meal service", map: { x: 658, y: 327, width: 104, height: 58 } },
  { code: "MUSIC-ROOM", name: "Music & Performing Arts Room", kind: "workshop", parent_code: "FLR-COMMUNITY", capacity: 32, accessible: true, bookable: true, zone: "community", purpose: "Music and performing arts teaching", map: { x: 658, y: 395, width: 104, height: 32 } },

  { code: "MAIN-GATE", name: "Main Gate", kind: "gate", parent_code: null, capacity: 60, accessible: true, bookable: false, zone: "arrival", purpose: "Primary pedestrian arrival, departure and visitor control", map: { x: 350, y: 560, width: 105, height: 42 }, aliases: ["North Gate"] },
  { code: "SERVICE-GATE", name: "Service Gate", kind: "gate", parent_code: null, capacity: 20, accessible: true, bookable: false, zone: "arrival", purpose: "Authorized service and delivery access", map: { x: 700, y: 535, width: 80, height: 34 } },
  { code: "BUS-BAY", name: "School Transport Bay", kind: "outdoor_area", parent_code: null, capacity: 12, accessible: true, bookable: false, zone: "arrival", purpose: "Bus arrival, boarding and dispersal", map: { x: 475, y: 515, width: 205, height: 70 } },
  { code: "VISITOR-PARKING", name: "Visitor Parking", kind: "outdoor_area", parent_code: null, capacity: 18, accessible: true, bookable: false, zone: "arrival", purpose: "Controlled short-stay visitor parking", map: { x: 40, y: 470, width: 150, height: 70 } },
  { code: "ASSEMBLY-COURT", name: "Assembly Court", kind: "outdoor_area", parent_code: null, capacity: 420, accessible: true, bookable: true, zone: "outdoor", purpose: "Morning assembly and whole-school gathering", map: { x: 205, y: 485, width: 245, height: 62 } },
  { code: "PLAY-FIELD", name: "Main Play Field", kind: "sports_area", parent_code: null, capacity: 240, accessible: true, bookable: true, zone: "outdoor", purpose: "Physical education and field sports", map: { x: 810, y: 90, width: 180, height: 315 } },
  { code: "BASKETBALL-COURT", name: "Basketball Court", kind: "sports_area", parent_code: null, capacity: 60, accessible: true, bookable: true, zone: "outdoor", purpose: "Basketball and outdoor activity", map: { x: 810, y: 425, width: 180, height: 105 } },
] as const;

export const CAMBRIDGE_OPERATIONAL_STAFF: readonly CambridgeOperationalStaffFixture[] = [
  { code: "OPS-001", first_name: "Raghav", last_name: "Menon", email: "raghav.menon@cambridge.example.test", phone: "+91 90000 11001", designation: "Campus Operations Manager", department: "Campus Operations", employment_type: "full_time", joined_on: "2022-06-01", home_space_code: "SCHOOL-OFFICE", responsibility_code: "school_duty", duty_label: "Daily campus operations coordination", duty_location: "School Office" },
  { code: "OFF-002", first_name: "Aditi", last_name: "Nair", email: "aditi.nair@cambridge.example.test", phone: "+91 90000 11002", designation: "Front Office Executive", department: "Administration", employment_type: "full_time", joined_on: "2023-04-03", home_space_code: "RECEPTION", responsibility_code: "school_duty", duty_label: "Reception and visitor desk coverage", duty_location: "Reception & Visitor Desk" },
  { code: "HLT-003", first_name: "Mary", last_name: "Thomas", email: "mary.thomas@cambridge.example.test", phone: "+91 90000 11003", designation: "School Nurse", department: "Student Wellbeing", employment_type: "full_time", joined_on: "2021-07-12", home_space_code: "INFIRMARY", responsibility_code: "school_duty", duty_label: "School-day health room coverage", duty_location: "Health Room & Infirmary" },
  { code: "WEL-004", first_name: "Leela", last_name: "Thomas", email: "leela.thomas@cambridge.example.test", phone: "+91 90000 11004", designation: "School Counsellor", department: "Student Wellbeing", employment_type: "part_time", joined_on: "2024-01-08", home_space_code: "WELLBEING", responsibility_code: "school_duty", duty_label: "Student wellbeing service", duty_location: "Counselling & Wellbeing Room" },
  { code: "LIB-005", first_name: "Imran", last_name: "Khan", email: "imran.khan.library@cambridge.example.test", phone: "+91 90000 11005", designation: "Librarian", department: "Learning Resources", employment_type: "full_time", joined_on: "2020-06-15", home_space_code: "LIBRARY", responsibility_code: "school_duty", duty_label: "Library and learning commons service", duty_location: "Library & Learning Commons" },
  { code: "FAC-006", first_name: "Prakash", last_name: "Gowda", email: "prakash.gowda@cambridge.example.test", phone: "+91 90000 11006", designation: "Facilities & Safety Supervisor", department: "Campus Operations", employment_type: "full_time", joined_on: "2019-04-01", home_space_code: "SCHOOL-OFFICE", responsibility_code: "safety_officer", duty_label: "Campus safety and facilities readiness", duty_location: "Campus-wide" },
  { code: "TRN-007", first_name: "Savita", last_name: "Rao", email: "savita.rao.transport@cambridge.example.test", phone: "+91 90000 11007", designation: "Transport Coordinator", department: "Transport", employment_type: "full_time", joined_on: "2022-04-04", home_space_code: "BUS-BAY", responsibility_code: "transport_attendant", duty_label: "Arrival and dispersal transport coordination", duty_location: "School Transport Bay" },
  { code: "SEC-008", first_name: "Mohan", last_name: "Kumar", email: "mohan.kumar.security@cambridge.example.test", phone: "+91 90000 11008", designation: "Security Supervisor", department: "Security", employment_type: "full_time", joined_on: "2020-08-10", home_space_code: "MAIN-GATE", responsibility_code: "school_duty", duty_label: "Main gate and visitor-control supervision", duty_location: "Main Gate" },
  { code: "ICT-009", first_name: "Deepak", last_name: "Yadav", email: "deepak.yadav.it@cambridge.example.test", phone: "+91 90000 11009", designation: "IT Support Technician", department: "Information Technology", employment_type: "full_time", joined_on: "2023-05-08", home_space_code: "LAB-COMPUTER", responsibility_code: "school_duty", duty_label: "Classroom and network support", duty_location: "Computer Laboratory" },
  { code: "LAB-010", first_name: "Neha", last_name: "Menon", email: "neha.menon.lab@cambridge.example.test", phone: "+91 90000 11010", designation: "Laboratory Assistant", department: "Science", employment_type: "full_time", joined_on: "2021-06-07", home_space_code: "LAB-SCI", responsibility_code: "school_duty", duty_label: "Science laboratory preparation and safety", duty_location: "Integrated Science Laboratory" },
  { code: "FNB-011", first_name: "Shobha", last_name: "Nair", email: "shobha.nair.canteen@cambridge.example.test", phone: "+91 90000 11011", designation: "Cafeteria Supervisor", department: "Food Services", employment_type: "contract", joined_on: "2025-04-01", home_space_code: "CANTEEN", responsibility_code: "school_duty", duty_label: "Meal-service readiness and supervision", duty_location: "Dining Hall & Canteen" },
] as const;

export function validateCambridgeCampusFixture(
  spaces: readonly CambridgeSpaceFixture[] = CAMBRIDGE_SPACES,
  staff: readonly CambridgeOperationalStaffFixture[] = CAMBRIDGE_OPERATIONAL_STAFF,
): void {
  const byCode = new Map<string, CambridgeSpaceFixture>();
  const aliases = new Map<string, string>();
  for (const space of spaces) {
    if (byCode.has(space.code)) throw new Error(`Duplicate Cambridge space code: ${space.code}`);
    if (space.capacity !== null && (!Number.isInteger(space.capacity) || space.capacity <= 0)) {
      throw new Error(`Invalid Cambridge space capacity: ${space.code}`);
    }
    for (const alias of space.aliases ?? []) {
      const normalized = alias.trim().toLocaleLowerCase("en-IN");
      if (!normalized) throw new Error(`Empty Cambridge space alias: ${space.code}`);
      const existing = aliases.get(normalized);
      if (existing && existing !== space.code) {
        throw new Error(`Ambiguous Cambridge space alias: ${alias}`);
      }
      aliases.set(normalized, space.code);
    }
    byCode.set(space.code, space);
  }
  for (const space of spaces) {
    if (space.parent_code && !byCode.has(space.parent_code)) {
      throw new Error(`Unknown Cambridge parent space: ${space.code} -> ${space.parent_code}`);
    }
    const visited = new Set([space.code]);
    let parent = space.parent_code ? byCode.get(space.parent_code) : undefined;
    while (parent) {
      if (visited.has(parent.code)) throw new Error(`Cyclic Cambridge space hierarchy at ${space.code}`);
      visited.add(parent.code);
      parent = parent.parent_code ? byCode.get(parent.parent_code) : undefined;
    }
  }
  const staffCodes = new Set<string>();
  const staffEmails = new Set<string>();
  for (const person of staff) {
    if (staffCodes.has(person.code)) throw new Error(`Duplicate Cambridge staff code: ${person.code}`);
    if (staffEmails.has(person.email.toLowerCase())) throw new Error(`Duplicate Cambridge staff email: ${person.email}`);
    if (!byCode.has(person.home_space_code)) throw new Error(`Unknown Cambridge staff home space: ${person.code}`);
    if (!person.email.endsWith("@cambridge.example.test")) throw new Error(`Cambridge staff email must be synthetic: ${person.code}`);
    staffCodes.add(person.code);
    staffEmails.add(person.email.toLowerCase());
  }
}

