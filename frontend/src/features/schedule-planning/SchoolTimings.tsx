import { useState } from 'react';
import { buildDayTimings } from './timings';
import type { SchedulePeriod } from './api';
export function SchoolTimings({room,onSave}:{room:string;onSave:(rows:SchedulePeriod[])=>Promise<void>}) {
  const [start,setStart]=useState('08:00');const [count,setCount]=useState(6);const [minutes,setMinutes]=useState(45);const [breakAfter,setBreakAfter]=useState(3);const [breakMinutes,setBreakMinutes]=useState(30);const [days,setDays]=useState([1,2,3,4,5]);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  return <details className="schedule-settings__allocations"><summary>Set up school timings</summary><form className="schedule-settings__form" onSubmit={async e=>{e.preventDefault();setError('');setBusy(true);try{await onSave(buildDayTimings({start,count,minutes,breakAfter,breakMinutes,days,room},()=>crypto.randomUUID()));}catch(cause){setError(cause instanceof Error?cause.message:'Could not save timings.');}finally{setBusy(false);}}}>
    <p>Creates empty lesson slots. Assign subjects and teachers before publishing.</p>
    <label>Starts at<input type="time" required value={start} onChange={e=>setStart(e.target.value)}/></label>
    <div className="schedule-settings__dates"><label>Lessons per day<input type="number" min={1} max={16} required value={count} onChange={e=>setCount(Number(e.target.value))}/></label><label>Minutes per lesson<input type="number" min={10} max={180} required value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/></label></div>
    <div className="schedule-settings__dates"><label>Break after lesson<input type="number" min={0} max={count} required value={breakAfter} onChange={e=>setBreakAfter(Number(e.target.value))}/></label><label>Break minutes<input type="number" min={0} max={120} required value={breakMinutes} onChange={e=>setBreakMinutes(Number(e.target.value))}/></label></div>
    <fieldset><legend>Teaching days</legend>{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i)=><label key={d} className="schedule-settings__check"><input type="checkbox" checked={days.includes(i+1)} onChange={e=>setDays(e.target.checked?[...days,i+1]:days.filter(n=>n!==i+1))}/>{d}</label>)}</fieldset>
    {error?<p role="alert">{error}</p>:null}<button disabled={busy||!days.length}>Create lesson slots</button>
  </form></details>;
}
