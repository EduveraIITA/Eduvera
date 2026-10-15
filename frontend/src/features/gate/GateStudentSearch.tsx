import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, LogIn, Search } from 'lucide-react';
import { findGateStudents, gateCommand, type GateStudentMatch } from './api';
import { gateError } from './gateError';

export function GateStudentSearch({ school, hindi, busy, onSelect }: {
  school: string; hindi: boolean; busy: boolean; onSelect: (student: GateStudentMatch) => void;
}) {
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  const queryClient = useQueryClient();
  const commands = useRef(new Map<string,string>());
  const [entering,setEntering]=useState<string|null>(null);
  const [entryError,setEntryError]=useState('');
  const [success,setSuccess]=useState('');
  const value = input.trim();
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(value), 250);
    return () => window.clearTimeout(timer);
  }, [value]);
  const matches = useQuery({
    queryKey: ['gate-students', school, term],
    queryFn: ({ signal }) => findGateStudents(school, term, signal),
    enabled: term.length >= 2 && value === term,
    staleTime: 30_000,
    retry: false,
  });
  const pending = value.length >= 2 && (value !== term || matches.isFetching);
  const results = value === term ? matches.data : undefined;
  useEffect(()=>{for(const student of matches.data??[])if(student.direction==='in')commands.current.delete(student.id);},[matches.data]);
  const label = hindi ? 'नाम या प्रवेश संख्या' : 'Name or admission number';
  async function markEntry(student:GateStudentMatch) {
    if(entering||busy)return;
    const command=commands.current.get(student.id)??crypto.randomUUID();
    commands.current.set(student.id,command);setEntering(student.id);setEntryError('');setSuccess('');
    try {
      await gateCommand(school,'movements',{student_id:student.id,direction:'in',identity_verified:true,command_id:command});
      queryClient.setQueriesData<GateStudentMatch[]>({queryKey:['gate-students',school]},rows=>rows?.map(row=>row.id===student.id?{...row,direction:'in'}:row));
      setSuccess(hindi?`${student.name} का प्रवेश दर्ज हुआ।`:`Entry recorded for ${student.name}.`);
      commands.current.delete(student.id);
      void queryClient.invalidateQueries({queryKey:['gate-students',school]});
    } catch(error) {
      setEntryError(gateError(error,hindi,hindi?'प्रवेश दर्ज होने की पुष्टि नहीं हुई। फिर कोशिश करें।':'Could not confirm entry. Retry this entry to safely check whether it was recorded.'));
      void queryClient.invalidateQueries({queryKey:['gate-students',school]});
    } finally {setEntering(null);}
  }
  return <section className="gate-search-panel" aria-labelledby="gate-search-title">
    <h2 id="gate-search-title">{hindi ? 'छात्र खोजें' : 'Find Student'}</h2>
    <p className="gate-search-status">{hindi?'छात्र की पहचान जाँचें, फिर प्रवेश दर्ज करें दबाएँ।':'Check the student’s identity, then tap Mark entry.'}</p>
    <form className="gate-search" role="search" onSubmit={event => { event.preventDefault(); setTerm(value); if (value === term && value.length >= 2) void matches.refetch(); }}>
      <label className="gate-search-field"><Search size={20} aria-hidden="true" />
        <input type="search" aria-label={label} placeholder={label} value={input} maxLength={100} autoFocus autoComplete="off" onChange={event => setInput(event.target.value)} />
      </label>
      <button className="gate-search-submit" disabled={value.length < 2 || pending || busy}>{hindi ? 'खोजें' : 'Search'}</button>
    </form>
    <div className="gate-search-status" role="status" aria-live="polite">
      {value.length < 2 ? (hindi ? 'खोजने के लिए कम से कम 2 अक्षर लिखें।' : 'Type at least 2 characters to find a student.')
        : pending ? (hindi ? 'छात्र खोज रहे हैं…' : 'Finding students…')
          : results?.length === 0 ? (hindi ? 'कोई छात्र नहीं मिला। नाम या प्रवेश संख्या जाँचें।' : 'No students found. Check the name or admission number.')
            : results ? (hindi ? `${results.length} छात्र मिले` : `${results.length} students found`) : null}
    </div>
    {matches.isError && value === term ? <p className="gate-error" role="alert">{hindi ? 'खोज नहीं हो सकी।' : 'Search could not be completed.'} <button onClick={() => void matches.refetch()}>{hindi ? 'फिर कोशिश करें' : 'Try again'}</button></p> : null}
    {success?<p className="gate-entry-success" role="status"><CheckCircle2 size={18}/>{success}</p>:null}
    {entryError?<p className="gate-error" role="alert">{entryError}</p>:null}
    <div className="gate-student-results" aria-busy={pending || busy || Boolean(entering)}>
      {!pending && results?.map(student => <article className="gate-student-row" key={student.id}><button className="gate-student-open" aria-label={`${hindi?'विवरण देखें':'View'} ${student.name}`} disabled={busy||Boolean(entering)} onClick={() => onSelect(student)}>
        {student.avatar_url ? <img src={student.avatar_url} alt="" /> : <span className="gate-result-avatar" aria-hidden="true">{student.name.slice(0, 1)}</span>}
        <span><strong>{student.name}</strong><small>{student.class_label} · {student.admission_number}</small></span><ArrowRight size={18} aria-hidden="true" />
      </button><button className={`gate-quick-entry${student.direction==='in'?' is-inside':''}`} aria-label={`${hindi?'प्रवेश दर्ज करें':'Mark entry for'} ${student.name}`} disabled={busy||Boolean(entering)||student.direction==='in'} onClick={()=>void markEntry(student)}>{student.direction==='in'?<CheckCircle2 size={17}/>:<LogIn size={17}/>}<span>{entering===student.id?(hindi?'दर्ज हो रहा है…':'Recording…'):student.direction==='in'?(hindi?'अंदर है':'Inside'):(hindi?'प्रवेश दर्ज करें':'Mark entry')}</span></button></article>)}
    </div>
  </section>;
}
