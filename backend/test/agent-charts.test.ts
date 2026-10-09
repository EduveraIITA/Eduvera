import { describe,it,expect } from 'vitest';
import { analyticsChart } from '../src/agent/charts.js';
import { availableCapabilities,findCapabilities,verificationScreen } from '../src/agent/catalogue.js';
const scope={userId:'u',schoolId:'s',portal:'principal' as const,studentId:null,permissions:[],timezone:'Asia/Kolkata'};
const data={status:'ready',scope:'Aarav',range:{from:'2026-09-01',to:'2026-10-09'},attendance:{present:8,late:1,half_day:1,absent:0,excused:2,comparison:{total:12,items:Array.from({length:12},(_,i)=>({name:'Subject '+i,percentage:i?90:null,attended:9,counted:10}))},trend:[{date:'2026-09-01',end:'2026-09-30',percentage:null,attended:0,denominator:0}]}};
describe('verified analytics charts',()=>{
  it('builds from source values only and labels truncated comparisons',()=>{
    const chart=analyticsChart('principal_analytics',{},data)!;
    expect(chart).toMatchObject({kind:'bar',scope:'Aarav',shown:8,total:12});expect(chart.points[0]?.value).toBeNull();
    expect(analyticsChart('principal_analytics',{chart:'none'},data)).toBeUndefined();
    expect(analyticsChart('unknown',{},data)).toBeUndefined();
    expect(analyticsChart('principal_analytics',{}, {...data,status:'choose_student'})).toBeUndefined();
  });
  it('does not turn missing trend values into zero or percentages into pie slices',()=>{
    expect(analyticsChart('principal_analytics',{chart:'attendance_trend'},data)).toMatchObject({kind:'line',points:[{value:null}]});
    const donut=analyticsChart('principal_analytics',{chart:'attendance_breakdown'},data)!;
    expect(donut.kind).toBe('donut');expect(donut.points.reduce((sum,p)=>sum+(p.value??0),0)).toBe(12);
  });
  it('routes multi-topic analytics to scoped tools and deep links the selected learner',()=>{
    const tools=availableCapabilities(scope);
    expect(findCapabilities('Give me analytics about Aarav Sharma',tools)[0]?.name).toBe('principal_analytics');
    const cap=tools.find(c=>c.name==='principal_analytics')!;
    expect(verificationScreen(cap,{topic:'results',period:'30'},scope,{student:{id:'learner'},class_id:'class'})).toContain('student_id=learner');
    expect(verificationScreen(cap,{chart:'results_distribution',period:'90',group_by:'class'},scope,{})).toBe('/principal/insights/results?period=90&compare=class');
    expect(verificationScreen(tools.find(c=>c.name==='insights')!,{chart:'attendance_trend'}, {...scope,portal:'parent',studentId:'child'},{})).toBe('/parent/insights/attendance?period=term&student_id=child');
    for(const portal of ['parent','student','teacher'] as const)expect(availableCapabilities({...scope,portal}).some(c=>c.name==='principal_analytics')).toBe(false);
    expect(()=>cap.schema.parse({sql:'SELECT *',chart:'attendance_trend'})).toThrow();
  });
});
