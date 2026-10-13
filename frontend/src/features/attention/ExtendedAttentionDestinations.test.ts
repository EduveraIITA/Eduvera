import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe,expect,it } from "vitest";

const source=(...parts:string[])=>readFileSync(join(process.cwd(),"src",...parts),"utf8");

describe("extended typed-attention destinations",()=>{
  it.each([
    [["features","school","ParentLiveRoutes.tsx"],"exactRecord ? <AttentionOpenAcknowledgement","staleAttentionRecord"],
    [["features","school","ParentLiveRoutes.tsx"],"exactAuthority ? <AttentionOpenAcknowledgement","staleAuthority"],
    [["features","assessments","AssessmentRoutes.tsx"],"assessmentLoaded||reportLoaded?<AttentionOpenAcknowledgement","staleAttention"],
    [["features","campus-events","CampusEventRoutes.tsx"],"exactAttentionTarget ? <AttentionOpenAcknowledgement","staleAttentionTarget"],
    [["features","office","FamilyFeesPage.tsx"],"exactReview ? <AttentionOpenAcknowledgement","staleAttentionReview"],
    [["features","restricted-care","RestrictedCarePage.tsx"],"expectedRevision === item.revision ? <AttentionOpenAcknowledgement","has changed since the alert"],
    [["features","governance","PolicyLibraryPage.tsx"],"exactPolicy ? <AttentionOpenAcknowledgement","no longer published to your role"],
  ] as const)("gates acknowledgement in %s on an exact loaded record",(parts,gate,stale)=>{
    const text=source(...parts);
    expect(text).toContain(gate);
    expect(text).toContain(stale);
  });
});
