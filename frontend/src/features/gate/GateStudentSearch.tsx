import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Search } from 'lucide-react';
import { findGateStudents, type GateStudentMatch } from './api';

export function GateStudentSearch({ school, hindi, busy, onSelect }: {
  school: string; hindi: boolean; busy: boolean; onSelect: (student: GateStudentMatch) => void;
}) {
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
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
  const label = hindi ? 'नाम या प्रवेश संख्या' : 'Name or admission number';
  return <section className="gate-search-panel" aria-labelledby="gate-search-title">
    <h2 id="gate-search-title">{hindi ? 'छात्र खोजें' : 'Find Student'}</h2>
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
    <div className="gate-list" aria-busy={pending || busy}>
      {!pending && results?.map(student => <button key={student.id} disabled={busy} onClick={() => onSelect(student)}>
        {student.avatar_url ? <img src={student.avatar_url} alt="" /> : <span className="gate-result-avatar" aria-hidden="true">{student.name.slice(0, 1)}</span>}
        <span><strong>{student.name}</strong><small>{student.class_label} · {student.admission_number}</small></span><ArrowRight size={18} aria-hidden="true" />
      </button>)}
    </div>
  </section>;
}
