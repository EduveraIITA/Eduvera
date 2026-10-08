import {describe,expect,it} from 'vitest';
import {evaluateSubjects,validTotal,type SubjectTotal} from '../src/student-pulse/pulse-rules.js';
const row=(subject:string,held:number,attended:number,excused=0):SubjectTotal=>({student_id:'learner',student_name:'Sample Learner',class_id:'class',class_name:'10A',term_id:'term',term_name:'Term 1',subject_id:subject,subject_name:subject,held,attended,excused});
describe('Student Pulse evidence rules',()=>{
 it('flags a supported subject gap, without inferring dates or motives',()=>{const signal=evaluateSubjects([row('Math',9,3),row('English',12,12)])[0]!;expect(signal).toMatchObject({flagged:true,eligible:9,missed:6,other_percentage:100});expect(signal).not.toHaveProperty('motive');expect(signal).not.toHaveProperty('previous_period');});
 it('excludes excused sessions instead of treating them as missed',()=>{expect(evaluateSubjects([row('Math',9,3,6),row('English',12,12)])[0]).toMatchObject({eligible:3,missed:0,percentage:100,flagged:false});});
 it('requires minimum subject and comparison samples',()=>{expect(evaluateSubjects([row('Math',4,0),row('English',12,12)])[0]!.flagged).toBe(false);expect(evaluateSubjects([row('Math',9,0),row('English',9,9)])[0]!.flagged).toBe(false);});
 it('requires at least three misses and a twenty-point gap',()=>{expect(evaluateSubjects([row('Math',5,3),row('English',12,12)])[0]!.flagged).toBe(false);expect(evaluateSubjects([row('Math',20,17),row('English',20,20)])[0]!.flagged).toBe(false);expect(evaluateSubjects([row('Math',15,12),row('English',20,20)])[0]!.flagged).toBe(true);});
 it('weights the other-subject denominator rather than averaging percentages',()=>{expect(evaluateSubjects([row('Math',10,3),row('English',10,5),row('Physics',90,90)])[0]!.other_percentage).toBe(95);});
 it('retains unknown zero-denominator rates',()=>{expect(evaluateSubjects([row('Math',0,0)])[0]).toMatchObject({percentage:null,other_percentage:null,gap:null,flagged:false});});
 it('discards inconsistent, negative, non-integer and non-finite totals',()=>{for(const invalid of [row('X',3,4),row('X',3,2,2),row('X',-1,0),row('X',3.5,2),row('X',Infinity,2)]){expect(validTotal(invalid)).toBe(false);expect(evaluateSubjects([invalid])).toEqual([]);}});
 it('never mixes learners, terms or classes',()=>{for(const property of ['student_id','term_id','class_id'] as const){const other={...row('English',12,12),[property]:'different'};expect(evaluateSubjects([row('Math',9,0),other])[0]!.flagged).toBe(false);}});
});
