import type { SchedulePeriod } from './api';
export function buildDayTimings(input:{start:string;count:number;minutes:number;breakAfter:number;breakMinutes:number;days:number[];room:string},id:()=>string):SchedulePeriod[] {
  const [h=0,m=0]=input.start.split(':').map(Number);
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.start)||!Number.isInteger(input.count)||input.count<1||input.count>16||input.minutes<10||input.minutes>180||input.breakAfter<0||input.breakAfter>input.count||input.breakMinutes<0||input.breakMinutes>120||!input.days.length||input.days.some(d=>!Number.isInteger(d)||d<1||d>7))throw new Error('Choose valid days, lesson times and a break.');
  const total=input.count*input.minutes+(input.breakAfter>0&&input.breakAfter<input.count?input.breakMinutes:0);
  if(h*60+m+total>=1440)throw new Error('The school day must finish before midnight.');
  const time=(n:number)=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
  return [...new Set(input.days)].flatMap(weekday=>{
    let cursor=h*60+m;let number=0;const rows:SchedulePeriod[]=[];
    const add=(title:string,minutes:number,slot_type:SchedulePeriod['slot_type'])=>{rows.push({id:id(),weekday,period_number:++number,starts_at:time(cursor),ends_at:time(cursor+minutes),title,slot_type,teacher_user_id:null,subject_id:null,room:slot_type==='break'?'':input.room});cursor+=minutes;};
    for(let i=1;i<=input.count;i++){add(`Lesson ${i}`,input.minutes,'class');if(i===input.breakAfter&&i<input.count&&input.breakMinutes)add('Break',input.breakMinutes,'break');}
    return rows;
  });
}
