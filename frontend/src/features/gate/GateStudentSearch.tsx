import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, LogIn, Search } from 'lucide-react';
import { findGateStudents, findGateStaff, gateCommand, type GateStaff, type GateStudentMatch } from './api';
import { gateError } from './gateError';

export function GateStudentSearch({ school, hindi, busy, onSelect, onSelectStaff }: {
  school: string; hindi: boolean; busy: boolean; onSelect: (student: GateStudentMatch) => void; onSelectStaff:(staff:GateStaff)=>void;
}) {
  const [personType,setPersonType]=useState<'students'|'staff'>('students');
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  const queryClient = useQueryClient();
  const commands = useRef(new Map<string,string>());
  const [entering,setEntering]=useState<string|null>(null);
  const [entryError,setEntryError]=useState('');
  const [success,setSuccess]=useState('');
  const value = input.trim();
  const searchable = (text:string) => text.length >= 2 || /^\d+$/.test(text);
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(value), 250);
    return () => window.clearTimeout(timer);
  }, [value]);
  const matches = useQuery({
    queryKey: ['gate-students', school, term],
    queryFn: ({ signal }) => findGateStudents(school, term, signal),
    enabled: searchable(term) && value === term,
    staleTime: 30_000,
    retry: false,
  });
  const staffMatches=useQuery({queryKey:['gate-staff',school,term],queryFn:({signal})=>findGateStaff(school,term,signal),enabled:personType==='staff'&&searchable(term)&&value===term,staleTime:30_000,retry:false});
  const pending = searchable(value) && (value !== term || (personType==='students'?matches.isFetching:staffMatches.isFetching));
  const results = value === term ? matches.data : undefined;
  const staffResults=value===term?staffMatches.data:undefined;
  useEffect(()=>{for(const student of matches.data??[])if(student.direction==='in')commands.current.delete(student.id);},[matches.data]);
  const label = hindi ? (personType==='students'?'नाम, प्रवेश या रोल संख्या':'स्टाफ नाम या कर्मचारी संख्या') : personType==='students'?'Search by name, admission ID or roll number':'Search by name, employee ID or email';
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
    <h2 id="gate-search-title">{hindi ? 'उपयोगकर्ता खोजें' : 'Search User'}</h2>
    <p className="gate-search-status">{hindi?'छात्र या स्टाफ को खोजें।':'Find a student or staff member to view and record their gate status.'}</p>
    <div className="gate-person-tabs" role="tablist" aria-label={hindi?'व्यक्ति का प्रकार':'Person type'}>
      <button role="tab" aria-selected={personType==='students'} onClick={()=>setPersonType('students')}>{hindi?'छात्र':'Students'}</button>
      <button role="tab" aria-selected={personType==='staff'} onClick={()=>setPersonType('staff')}>{hindi?'स्टाफ':'Staff'}</button>
    </div>
    <form className="gate-search" role="search" onSubmit={event => { event.preventDefault(); setTerm(value); if (value === term && searchable(value)) void (personType==='students'?matches.refetch():staffMatches.refetch()); }}>
      <label className="gate-search-field"><Search size={20} aria-hidden="true" />
        <input type="search" aria-label={label} placeholder={label} value={input} maxLength={100} autoFocus autoComplete="off" onChange={event => setInput(event.target.value)} />
      </label>
      <button className="gate-search-submit" disabled={!searchable(value) || pending || busy}>{hindi ? 'खोजें' : 'Search'}</button>
    </form>
    <div className="gate-search-status" role="status" aria-live="polite">
      {!searchable(value) ? (hindi ? 'खोजने के लिए कम से कम 2 अक्षर लिखें।' : 'Type a name, roll number or admission number. No class selection needed.')
        : pending ? (hindi ? 'छात्र खोज रहे हैं…' : 'Finding students…')
          : (personType==='students'?results:staffResults)?.length === 0 ? (hindi ? 'कोई परिणाम नहीं मिला। फिर खोजें।' : `No ${personType==='students'?'students':'staff'} found. Try another search.`)
            : (personType==='students'?results:staffResults) ? (hindi ? `${(personType==='students'?results:staffResults)?.length??0} परिणाम मिले` : `${(personType==='students'?results:staffResults)?.length??0} results found`) : null}
    </div>
    {(personType==='students'?matches.isError:staffMatches.isError) && value === term ? <p className="gate-error" role="alert">{hindi ? 'खोज नहीं हो सकी।' : 'Search could not be completed.'} <button onClick={() => void (personType==='students'?matches.refetch():staffMatches.refetch())}>{hindi ? 'फिर कोशिश करें' : 'Try again'}</button></p> : null}
    {success?<p className="gate-entry-success" role="status"><CheckCircle2 size={18}/>{success}</p>:null}
    {entryError?<p className="gate-error" role="alert">{entryError}</p>:null}
    <div className="gate-student-results" aria-busy={pending || busy || Boolean(entering)}>
      {personType==='students'&&!pending && results?.map(student => <article className="gate-student-row" key={student.id}><button className="gate-student-open" aria-label={`${hindi?'विवरण देखें':'View'} ${student.name}`} disabled={busy||Boolean(entering)} onClick={() => onSelect(student)}>
        {student.avatar_url ? <img src={student.avatar_url} alt="" /> : <span className="gate-result-avatar" aria-hidden="true">{student.name.slice(0, 1)}</span>}
        <span><strong>{student.name}</strong><small>{student.class_label} · {hindi?'प्रवेश सं.':'Adm:'} {student.admission_number}</small>{student.roll_number!=null?<small>{hindi?'रोल नं.':'Roll no:'} {student.roll_number}</small>:null}<span className="gate-result-state">{student.direction==='in'?(hindi?'अंतिम गेट रिकॉर्ड: प्रवेश':'Last gate record: entered'):student.direction==='out'?(hindi?'अंतिम गेट रिकॉर्ड: निकास':'Last gate record: exited'):(hindi?'कोई गेट रिकॉर्ड नहीं':'No gate movement recorded')}</span></span><ArrowRight size={18} aria-hidden="true" />
      </button><button className={`gate-quick-entry${student.direction==='in'?' is-inside':''}`} aria-label={`${hindi?'प्रवेश दर्ज करें':'Mark entry for'} ${student.name}`} disabled={busy||Boolean(entering)||student.direction==='in'} onClick={()=>void markEntry(student)}>{student.direction==='in'?<CheckCircle2 size={17}/>:<LogIn size={17}/>}<span>{entering===student.id?(hindi?'दर्ज हो रहा है…':'Recording…'):student.direction==='in'?(hindi?'अंदर है':'Inside'):(hindi?'प्रवेश दर्ज करें':'Mark entry')}</span></button></article>)}
      {personType==='staff'&&!pending&&staffResults?.map(staff=><article className="gate-student-row" key={staff.id}><button className="gate-student-open" aria-label={`${hindi?'विवरण देखें':'View'} ${staff.name}`} disabled={busy||Boolean(entering)} onClick={()=>onSelectStaff(staff)}>
        {staff.avatar_url?<img src={staff.avatar_url} alt=""/>:<span className="gate-result-avatar" aria-hidden="true">{staff.name.slice(0,1)}</span>}
        <span><strong>{staff.name}</strong><small>{staff.designation} · {staff.staff_code}</small><span className="gate-result-state">{staff.direction==='in'?(hindi?'अंतिम गेट रिकॉर्ड: प्रवेश':'Last gate record: entered'):staff.direction==='out'?(hindi?'अंतिम गेट रिकॉर्ड: निकास':'Last gate record: exited'):(hindi?'कोई गेट रिकॉर्ड नहीं':'No gate movement recorded')}</span></span><ArrowRight size={18}/></button></article>)}
    </div>
  </section>;
}
