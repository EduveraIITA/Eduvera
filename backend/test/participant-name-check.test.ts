import { describe, expect, it } from "vitest";
import { participantNameCheckSchema } from "../src/people/participant-name-check.js";

describe("bounded participant name preview contract", () => {
  it("accepts a complete 150-character name without splitting or altering internal whitespace", () => {
    const name="A".repeat(150);
    expect(participantNameCheckSchema.parse({ names:[{row_id:" row-1 ",name:` ${name} `},{row_id:"two",name:"Mira  Khan"}] }))
      .toEqual({names:[{row_id:"row-1",name},{row_id:"two",name:"Mira  Khan"}]});
  });
  it("rejects empty, excessive, unknown or ambiguous rows before any match query", () => {
    for(const body of [{names:[]},{names:Array.from({length:101},(_,index)=>({row_id:String(index),name:"Person"}))},
      {names:[{row_id:"one",name:" "}]},{names:[{row_id:"one",name:"A".repeat(151)}]},
      {names:[{row_id:"one",name:"Person",email:"private@example.test"}]},{names:[{row_id:"one",name:"Person"}],school_id:"other"},
      {names:[{row_id:"same",name:"Mira"},{row_id:" same ",name:"Other"}]}]) {
      expect(()=>participantNameCheckSchema.parse(body)).toThrow();
    }
  });
});
