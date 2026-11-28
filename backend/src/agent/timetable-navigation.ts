import { z } from 'zod';

const calendarDate = z.iso.date();
const ordinal = /^(?:the )?(\d{1,2})(?:st|nd|rd|th)?$/;

// Exact, read-only navigation can run without a model round trip. Extra qualifiers,
// class names, compound requests and other languages go through normal tool selection.
export function timetableNavigationDate(question:string, today:string, previousDate?:string):string|undefined {
  const text=question.trim().toLowerCase().replace(/[.!?]+$/, '').replace(/[’']/g, '').replace(/\s+/g, ' ');
  const day=ordinal.exec(text);
  if(day && previousDate && calendarDate.safeParse(previousDate).success) {
    const candidate=previousDate.slice(0,8)+day[1]!.padStart(2,'0');
    return calendarDate.safeParse(candidate).data;
  }
  const command=/^(?:please )?(?:open|show(?: me)?|view|go to|take me to|bring up) (?:the |my |our )?(.+)$/.exec(text);
  if(!command)return;
  const target=/^(?:(today[s]?|tomorrow[s]?|yesterday[s]?) )?(?:timetable|schedule|agenda)(?: (?:for |on )?(today|tomorrow|yesterday|\d{4}-\d{2}-\d{2}))?$/.exec(command[1]!);
  if(!target || target[1] && target[2])return;
  const date=target[2]??target[1]?.replace(/s$/,'')??'today';
  if(calendarDate.safeParse(date).success)return date;
  const offset=date==='tomorrow'?1:date==='yesterday'?-1:0;
  return new Date(Date.parse(today+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
}
