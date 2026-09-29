import { useState } from "react";
import { useInfiniteQuery,useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft,Plus,UsersRound } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { enrollmentOptions,listStudents } from "./api";
import { EnrollmentForm } from "./EnrollmentForm";
import { GuardianAuthorityPanel } from "./GuardianAuthorityPanel";
import "./people.css";
export default function PeoplePage(){
  const auth=useAuth();const schools=auth.memberships.filter(m=>m.role==="admin");const [selected,setSelected]=useState("");const schoolId=selected||schools[0]?.school_id;
  return <OperationsShell portal="principal" active="home" title="Students & guardians" subtitle="School records" schoolName={schools.find(s=>s.school_id===schoolId)?.school_name}><div className="operations-stack">
    <Link to="/principal" className="people-back"><ArrowLeft size={17}/>Overview</Link>
    {schools.length>1?<label className="people-school">School<select value={schoolId} onChange={e=>setSelected(e.target.value)}>{schools.map(s=><option key={s.school_id} value={s.school_id}>{s.school_name}</option>)}</select></label>:null}
    {schoolId?<Directory key={schoolId} schoolId={schoolId}/>:<p role="alert">An active school administrator membership is required.</p>}
  </div></OperationsShell>;
}
function Directory({schoolId}:{schoolId:string}){
  const [search,setSearch]=useState("");const [submitted,setSubmitted]=useState("");const [adding,setAdding]=useState(false);const [saved,setSaved]=useState("");
  const [authorityId,setAuthorityId]=useState<string|null>(null);
  const options=useQuery({queryKey:["school","people","options",schoolId],queryFn:()=>enrollmentOptions(schoolId)});
  const query=useInfiniteQuery({queryKey:["school","people","students",schoolId,submitted],queryFn:({pageParam})=>listStudents(schoolId,submitted,pageParam),initialPageParam:undefined as string|undefined,getNextPageParam:p=>p.next_cursor??undefined});
  const rows=query.data?.pages.flatMap(p=>p.results)??[];
  return <>
    <header className="people-heading"><div><h1 className="people-page-title">Students & guardians</h1><p className="people-muted">Enrollment and family records for your school.</p></div><div className="people-authority-actions"><Link className="people-secondary" to={`/principal/students/import?school=${schoolId}`}>Import students</Link><button type="button" className="people-primary" disabled={!options.data?.results.length||adding} onClick={()=>{setAdding(true);setSaved("");}}><Plus size={17}/>Add student</button></div></header>
    {saved?<p role="status" className="people-success">{saved} is enrolled. Student and guardian records are saved.</p>:null}
    {authorityId?<GuardianAuthorityPanel key={authorityId} schoolId={schoolId} id={authorityId} onClose={()=>setAuthorityId(null)}/>:null}
    {options.isError?<p role="alert" className="people-error">Enrollment options could not load. <button type="button" onClick={()=>void options.refetch()}>Try again</button></p>:null}
    {options.data?.results.length===0?<p role="status">Set up an active academic term and class before enrolling students.</p>:null}
    {adding&&options.data?.results.length?<EnrollmentForm schoolId={schoolId} options={options.data.results} onCancel={()=>setAdding(false)} onSaved={name=>{setSaved(name);setAdding(false);setSubmitted(name);setSearch(name);}}/>:null}
    <section className="people-panel"><form className="people-search" onSubmit={e=>{e.preventDefault();setSubmitted(search.trim());}}><label>Find a student<input type="search" placeholder="Name or admission number" maxLength={80} value={search} onChange={e=>setSearch(e.target.value)}/></label><button className="people-secondary" type="submit">Search</button></form>
      {query.isPending?<p role="status">Loading student records…</p>:null}
      {query.isError?<p role="alert" className="people-error">Records could not load. <button type="button" onClick={()=>void query.refetch()}>Try again</button></p>:null}
      {!query.isPending&&!query.isError&&!rows.length?<div className="people-empty"><UsersRound size={24}/><p>No students match this search.</p></div>:null}
      <ul className="people-list">{rows.map(s=><li key={s.id}><header><div><h2>{s.name}</h2><p>{s.admission_number} · {s.class_name} · Roll {s.roll_number}</p></div><span className="people-account">{s.has_account?"Student account linked":"No student login"}</span></header><div className="people-family">{s.guardians.map(g=><div key={g.id}><strong>{g.name}</strong><span>{g.relationship} · {g.phone||"Phone not recorded"}</span><small>{g.has_account?"Guardian account linked":"School contact · no app login"}</small><button type="button" className="people-secondary people-permission-link" disabled={Boolean(authorityId)} aria-label={`Manage ${g.name}'s permissions for ${s.name}`} onClick={()=>setAuthorityId(g.id)}>Manage permissions</button></div>)}</div></li>)}</ul>
      {query.hasNextPage?<button type="button" className="people-secondary" disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>{query.isFetchingNextPage?"Loading…":"Load more students"}</button>:null}
    </section>
  </>;
}
