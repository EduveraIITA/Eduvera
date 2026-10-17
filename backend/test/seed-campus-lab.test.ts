import { describe, expect, it } from "vitest";
import {
  CAMBRIDGE_OPERATIONAL_STAFF,
  CAMBRIDGE_SPACES,
  cambridgeFixtureId,
  validateCambridgeCampusFixture,
} from "../src/database/cambridge-campus-fixture.js";
import { assertCampusLabSeedAllowed } from "../src/database/seed-campus-lab.js";

describe("Campus Lab fixture seed guard",()=>{
  it("requires private demo mode, explicit opt-in and a non-production environment",()=>{
    expect(()=>assertCampusLabSeedAllowed({demoMode:true,explicitOptIn:true,environment:"development"})).not.toThrow();
    expect(()=>assertCampusLabSeedAllowed({demoMode:false,explicitOptIn:true,environment:"development"})).toThrow(/DEMO_MODE/);
    expect(()=>assertCampusLabSeedAllowed({demoMode:true,explicitOptIn:false,environment:"development"})).toThrow(/SEED_CAMPUS_LAB/);
    expect(()=>assertCampusLabSeedAllowed({demoMode:true,explicitOptIn:true,environment:"production"})).toThrow(/limited to development/);
  });

  it("describes a bounded, connected and campus-realistic synthetic topology",()=>{
    expect(()=>validateCambridgeCampusFixture()).not.toThrow();
    expect(new Set(CAMBRIDGE_SPACES.map((space)=>space.code)).size).toBe(CAMBRIDGE_SPACES.length);
    expect(CAMBRIDGE_SPACES.filter((space)=>space.kind==="building")).toHaveLength(3);
    expect(CAMBRIDGE_SPACES.filter((space)=>space.kind==="classroom")).toHaveLength(8);
    expect(CAMBRIDGE_SPACES.filter((space)=>space.kind==="gate").map((space)=>space.code)).toContain("MAIN-GATE");
    expect(CAMBRIDGE_SPACES.map((space)=>space.code)).toEqual(expect.arrayContaining([
      "RECEPTION","SCHOOL-OFFICE","PRINCIPAL-OFFICE","WELLBEING","INFIRMARY",
      "LAB-SCI","LAB-COMPUTER","LIBRARY","STAFF-ROOM","CANTEEN","AUDITORIUM",
      "ASSEMBLY-COURT","PLAY-FIELD","BUS-BAY",
    ]));
    expect(CAMBRIDGE_SPACES.find((space)=>space.code==="ROOM-201")?.aliases).toContain("Room 201");
    expect(CAMBRIDGE_SPACES.every((space)=>space.map.width>0&&space.map.height>0)).toBe(true);
  });

  it("keeps operational people synthetic and gives every position a real campus context",()=>{
    expect(CAMBRIDGE_OPERATIONAL_STAFF).toHaveLength(11);
    expect(CAMBRIDGE_OPERATIONAL_STAFF.every((person)=>person.email.endsWith("@cambridge.example.test"))).toBe(true);
    expect(CAMBRIDGE_OPERATIONAL_STAFF.map((person)=>person.designation)).toEqual(expect.arrayContaining([
      "Campus Operations Manager","School Nurse","School Counsellor","Librarian",
      "Facilities & Safety Supervisor","Transport Coordinator","Security Supervisor",
      "IT Support Technician","Laboratory Assistant","Cafeteria Supervisor",
    ]));
    const spaceCodes=new Set(CAMBRIDGE_SPACES.map((space)=>space.code));
    expect(CAMBRIDGE_OPERATIONAL_STAFF.every((person)=>spaceCodes.has(person.home_space_code))).toBe(true);
  });

  it("uses stable fixture identifiers without colliding across entity kinds",()=>{
    const first=cambridgeFixtureId("space:MAIN-GATE");
    expect(first).toBe(cambridgeFixtureId("space:MAIN-GATE"));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first).not.toBe(cambridgeFixtureId("staff:MAIN-GATE"));
  });

  it("rejects ambiguous fixture data before opening a database transaction",()=>{
    expect(()=>validateCambridgeCampusFixture([
      CAMBRIDGE_SPACES[0]!,
      {...CAMBRIDGE_SPACES[0]!},
    ],CAMBRIDGE_OPERATIONAL_STAFF)).toThrow(/Duplicate Cambridge space code/);
    expect(()=>validateCambridgeCampusFixture([
      {...CAMBRIDGE_SPACES[0]!,parent_code:"MISSING"},
    ],[])).toThrow(/Unknown Cambridge parent space/);
    expect(()=>validateCambridgeCampusFixture([
      {...CAMBRIDGE_SPACES[0]!,aliases:["Legacy Room"]},
      {...CAMBRIDGE_SPACES[1]!,aliases:["legacy room"]},
    ],[])).toThrow(/Ambiguous Cambridge space alias/);
  });
});
