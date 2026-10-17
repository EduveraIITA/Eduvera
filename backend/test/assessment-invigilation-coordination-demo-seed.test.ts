import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import {
  assertAssessmentInvigilationCoordinationDemoSeedAllowed,
} from "../src/database/seed-assessment-invigilation-coordination.js";

const seed=readFileSync(
  new URL("../src/database/seed-assessment-invigilation-coordination.ts",import.meta.url),
  "utf8",
);
const packageJson=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8")) as {
  scripts:Record<string,string>;
};

describe("assessment-invigilation coordination demo seed",()=>{
  it("requires explicit demo opt-in and a non-production environment",()=>{
    expect(()=>assertAssessmentInvigilationCoordinationDemoSeedAllowed({demoMode:false,explicitOptIn:true,environment:"development"})).toThrow(/DEMO_MODE/);
    expect(()=>assertAssessmentInvigilationCoordinationDemoSeedAllowed({demoMode:true,explicitOptIn:false,environment:"development"})).toThrow(/SEED_ASSESSMENT_INVIGILATION_COORDINATION/);
    for(const environment of ["production","stage","staging","preview",""]){
      expect(()=>assertAssessmentInvigilationCoordinationDemoSeedAllowed({demoMode:true,explicitOptIn:true,environment}),environment||"empty").toThrow(/limited to development/);
    }
    expect(()=>assertAssessmentInvigilationCoordinationDemoSeedAllowed({demoMode:true,explicitOptIn:true,environment:"local"})).not.toThrow();
  });

  it("installs only an explicit exact-recipient Offer route and capability",()=>{
    expect(seed).toContain("'assessment_invigilation:respond'");
    expect(seed).toContain("'assessment.invigilation.offered'");
    expect(seed).toContain('selector_key:"assessment_invigilation_recipient"');
    expect(seed).toContain('recipient_strategy:"administrator_selected"');
    expect(seed).not.toContain("auto_accept");
  });

  it("runs in the guarded demo seed chain",()=>{
    expect(packageJson.scripts["db:seed:assessment-invigilation-coordination"])
      .toContain("DEMO_MODE=true SEED_ASSESSMENT_INVIGILATION_COORDINATION=true");
    expect(packageJson.scripts["db:seed"]).toContain("db:seed:assessment-invigilation-coordination");
  });
});
