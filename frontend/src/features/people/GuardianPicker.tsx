import { useState,type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchGuardians,type GuardianInput } from "./api";
export function GuardianPicker({schoolId,value,onChange}:{schoolId:string;value:GuardianInput;onChange:(value:GuardianInput)=>void}) {
  const [search,setSearch]=useState(""); const [submitted,setSubmitted]=useState("");
  const query=useQuery({queryKey:["school","people","guardians",schoolId,submitted],queryFn:()=>searchGuardians(schoolId,submitted),enabled:value.mode==="existing"&&submitted.length>=2});
  const runSearch=(event:FormEvent)=>{event.preventDefault();onChange({mode:"existing",id:""});setSubmitted(search.trim());};
  return <fieldset className="people-fieldset"><legend>Primary guardian</legend>
    <label>Guardian record<select value={value.mode} onChange={e=>onChange(e.target.value==="existing"?{mode:"existing",id:""}:{mode:"new",first_name:"",last_name:"",phone:"",email:""})}><option value="new">Add a new guardian</option><option value="existing">Use an existing guardian</option></select></label>
    {value.mode==="new"?<div className="people-form-grid">
      <label>Guardian first name<input required maxLength={150} autoComplete="off" value={value.first_name} onChange={e=>onChange({...value,first_name:e.target.value})}/></label>
      <label>Guardian last name<input maxLength={150} autoComplete="off" value={value.last_name} onChange={e=>onChange({...value,last_name:e.target.value})}/></label>
      <label>Contact phone<input required type="tel" maxLength={25} value={value.phone} onChange={e=>onChange({...value,phone:e.target.value})}/></label>
      <label>Contact email <span className="people-muted">(optional)</span><input type="email" maxLength={254} value={value.email} onChange={e=>onChange({...value,email:e.target.value})}/></label>
    </div>:<div className="people-guardian-search">
      <label>Find guardian by name, phone or admission number<input type="search" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")runSearch(e);}}/></label>
      <button type="button" className="people-secondary" disabled={search.trim().length<2} onClick={runSearch}>Search guardians</button>
      {query.isFetching?<p role="status">Finding guardians…</p>:null}
      {query.isError?<p role="alert">Could not find guardians. <button type="button" onClick={()=>void query.refetch()}>Try again</button></p>:null}
      {query.data?<label>Choose the verified guardian<select required value={value.id} onChange={e=>onChange({...value,id:e.target.value})}><option value="">Select guardian</option>{query.data.results.map(g=><option key={g.id} value={g.id}>{g.name} · {g.phone} · {g.linked_admissions}</option>)}</select></label>:null}
      {query.data?.results.length===0?<p role="status">No matching guardian. Check the spelling or add a new record.</p>:null}
      <p className="people-muted">Confirm the guardian’s identity and linked children before selecting a record.</p>
    </div>}
  </fieldset>;
}
