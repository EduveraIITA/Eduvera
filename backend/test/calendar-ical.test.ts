import {describe,expect,it} from 'vitest';
import {serializeCalendar} from '../src/calendar-integrations/ical.js';

describe('provider-independent iCalendar feed',()=>{
  it('serializes stable timed and all-day events without exposing unsafe text',()=>{
    const result=serializeCalendar({name:'Cambridge, School',timezone:'Asia/Kolkata',generatedAt:new Date('2026-10-14T06:00:00Z'),events:[
      {uid:'period-1@edura',title:'Mathematics; Algebra',description:'Line one\nLine two',location:'Room 201',start:new Date('2026-10-14T03:30:00Z'),end:new Date('2026-10-14T04:15:00Z'),sequence:2},
      {uid:'holiday-1@edura',title:'Diwali',start:'2026-10-20',end:'2026-10-21',allDay:true},
    ]});
    expect(result).toContain('X-WR-CALNAME:Cambridge\\, School\r\n');
    expect(result).toContain('UID:period-1@edura\r\n');
    expect(result).toContain('DTSTART:20261014T033000Z\r\n');
    expect(result).toContain('SUMMARY:Mathematics\\; Algebra\r\n');
    expect(result).toContain('DESCRIPTION:Line one\\nLine two\r\n');
    expect(result).toContain('DTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261021\r\n');
    expect(result.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('folds long UTF-8 properties on continuation lines',()=>{
    const result=serializeCalendar({name:'Edura',timezone:'Asia/Kolkata',generatedAt:new Date('2026-10-14T06:00:00Z'),events:[
      {uid:'long@edura',title:'विद्यालय '.repeat(20),start:new Date('2026-10-14T03:30:00Z'),end:new Date('2026-10-14T04:15:00Z')},
    ]});
    expect(result).toMatch(/SUMMARY:[^\r]+\r\n [^\r]+/);
    for(const line of result.split('\r\n'))expect(Buffer.byteLength(line,'utf8')).toBeLessThanOrEqual(75);
  });
});
