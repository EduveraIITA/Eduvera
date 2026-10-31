import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, ChevronRight, ShieldCheck } from 'lucide-react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { OperationsShell } from '../../pages/operations/OperationsShell';
import { ProductIcon } from '../../components/ProductIcon';
import { InfoSummary } from '../../components/InfoSummary';
import { OnboardingFrame } from './OnboardingFrame';
import { goalIconNames } from './StartingPoints';
import { getProgressiveSetup, getProgressiveWorkspace, prepareCapability, saveOnboardingResume, saveWorkspaceProfile, type CapabilityReadiness, type GoalKey, type ProgressiveSetup, type SetupResult } from './progressive-api';
import { workspaceQueryRoot } from '../workspace/useWorkspaceManifest';
import { useExecutionEnvironment } from '../simulation/ExecutionEnvironmentContext';
import { capabilityReadinessPresentation } from './capabilityReadinessPresentation';
import './progressive-setup-presentation.css';

type SetupPresentation = 'onboarding'|'workspace';

function ProgressiveSetupFrame({children,onBack,backTo,step,presentation,busy=false,focusKey}:{children:ReactNode;onBack?:()=>void;backTo:string;step?:string;presentation:SetupPresentation;busy?:boolean;focusKey?:string}) {
  const contentRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{contentRef.current?.querySelector('h1')?.focus();},[focusKey]);
  const content=<div className="progressive-setup" ref={contentRef} onClickCapture={event=>{if(busy&&event.target instanceof Element&&event.target.closest('a[href]')){event.preventDefault();event.stopPropagation();}}}>{children}</div>;
  if(presentation==='onboarding')return <OnboardingFrame backTo={backTo} onBack={onBack} step={step} busy={busy}>{content}</OnboardingFrame>;
  return <OperationsShell active="more" title="Campus setup" backTo={backTo} onBack={onBack} beforeBack={()=>!busy} contentHasHeading><div className="campus-start campus-start--workspace"><div className="campus-start__body">{step?<p className="campus-start__wayfinding">{step}</p>:null}{content}</div></div></OperationsShell>;
}

function SetupHeader({title,description,capability}:{title:string;description?:string;capability?:GoalKey}) {
  return <header className="progressive-setup__header">
    {capability?<ProductIcon name={goalIconNames[capability]} size={32}/>:null}
    <div><h1 tabIndex={-1}>{title}</h1>{description?<p className="campus-start__lead">{description}</p>:null}</div>
  </header>;
}

export default function ProgressiveSetupPage({presentation='onboarding'}:{presentation?:SetupPresentation}={}) {
  const auth=useAuth();const [params,setParams]=useSearchParams();const cache=useQueryClient();
  const environment=useExecutionEnvironment();
  const workspace=useQuery({queryKey:['onboarding','progressive',auth.user?.id],queryFn:getProgressiveWorkspace});
  const school=workspace.data?.workspace?.id??'';
  const setup=useQuery({queryKey:['onboarding','setup',school,auth.user?.id,environment.mode,
    ...(environment.mode==='simulation'?[environment.namespaceId,environment.runId,environment.unavailable?'unavailable':environment.worldRevision??0]:[])],
    queryFn:()=>getProgressiveSetup(school),enabled:Boolean(school)});
  const task=params.get('task') as GoalKey|null;
  const [result,setResult]=useState<SetupResult|null>(null);const [profileOpen,setProfileOpen]=useState(false);const [profileError,setProfileError]=useState('');const [saving,setSaving]=useState(false);
  const all=setup.data?[...setup.data.working_now,...setup.data.useful_next,...setup.data.available_anytime]:[];
  const item=all.find(value=>value.capability===task);
  const activeCapability=item?.capability;
  const sourceOwnedContinuation=Boolean(task==='fees'||task==='assignments'||task==='resources'||task==='facilities'||task==='accommodation'||task==='dining'||task==='timetable'&&item?.timetable_operation);
  useEffect(()=>{if(environment.mode==='live'&&school&&task&&activeCapability&&!sourceOwnedContinuation)void saveOnboardingResume({step:'first_use',goal:task,path:`/more/setup/capabilities?task=${task}`}).catch(()=>undefined);},[environment.mode,school,task,activeCapability,sourceOwnedContinuation]);
  async function completed(value:SetupResult){await auth.refresh();await Promise.all([cache.invalidateQueries({queryKey:['onboarding']}),cache.invalidateQueries({queryKey:workspaceQueryRoot})]);setResult(value);}
  function home(){setResult(null);setParams({});}
  async function rename(event:FormEvent<HTMLFormElement>){event.preventDefault();setSaving(true);setProfileError('');const value=new FormData(event.currentTarget).get('name');try{await saveWorkspaceProfile({display_name:typeof value==='string'?value:''});await auth.refresh();await workspace.refetch();setProfileOpen(false);}catch(cause){setProfileError((cause as Error).message);}finally{setSaving(false);}}
  if(workspace.isPending||school&&setup.isPending)return <ProgressiveSetupFrame presentation={presentation} backTo="/more/setup"><h1>Campus setup</h1><p role="status">Finding your next step…</p></ProgressiveSetupFrame>;
  if(workspace.isError||setup.isError)return <ProgressiveSetupFrame presentation={presentation} backTo="/more/setup"><h1>We couldn’t load your setup.</h1><p role="alert">{workspace.error?.message??setup.error?.message}</p><button className="campus-start__primary" onClick={()=>{void workspace.refetch();void setup.refetch();}}>Try again</button></ProgressiveSetupFrame>;
  if(!school)return <Navigate to="/onboarding/start" replace/>;
  if(workspace.data?.status==='purpose_required'&&!task)return <Navigate to="/onboarding/start" replace/>;
  if(!setup.data)return null;
  if(task&&!item)return <ProgressiveSetupFrame presentation={presentation} backTo="/more/setup/capabilities" onBack={home}><h1>This setup step isn’t available</h1><p className="campus-start__lead">Your available starting points may have changed. Choose a current step without changing any campus records.</p><button className="campus-start__primary" type="button" onClick={home}>Choose a setup step</button></ProgressiveSetupFrame>;
  if(result)return <ProgressiveSetupFrame presentation={presentation} backTo="/more/setup" onBack={home} step="Ready to use" focusKey="accepted">
    <div className="progressive-setup__accepted" aria-hidden="true"><Check size={28}/></div>
    <SetupHeader title={result.capability==='attendance'?'Your first register is ready.':'Your entry point is ready.'} description={result.capability==='attendance'?'Open attendance to record your first session. Your people and group can be reused across the campus.':'Open the gate register to record arrivals and departures. Visitors don’t need an app account or a student record.'}/>
    {result.notes.length?<section className="progressive-setup__receipt" aria-label="Accepted setup details"><h2>What’s been set up</h2><ul>{result.notes.map(note=><li key={note}>{note}</li>)}</ul></section>:null}
    <Link className="campus-start__primary" to={result.destination}>{result.capability==='attendance'?'Open attendance':'Open gate register'}<ArrowRight size={19}/></Link>
    <button type="button" className="campus-start__quiet" onClick={home}>See what’s working and what’s next</button>
  </ProgressiveSetupFrame>;
  if(task==='attendance'&&item?.status!=='working')return <Navigate to="/areas/timetable/planning?create=attendance" replace/>;
  if(task==='assignments')return <Navigate to="/areas/messages/assignments" replace/>;
  if(task==='fees')return <Navigate to={item?.fees_operation?.destination??'/areas/fees/ledger'} replace/>;
  if(task==='resources')return <Navigate to={item?.resources_operation?.destination??'/areas/resources'} replace/>;
  if(task==='facilities')return <Navigate to={item?.facilities_operation?.destination??'/areas/facilities'} replace/>;
  if(task==='accommodation')return <Navigate to={item?.accommodation_operation?.destination??'/areas/accommodation'} replace/>;
  if(task==='dining')return <Navigate to={item?.dining_operation?.destination??'/areas/dining'} replace/>;
  if(task==='gate'&&item&&(item.status!=='working'||params.get('configure')==='gate'))return <GateStart key={school} school={school} data={setup.data} onComplete={completed} onBack={item.status==='working'?()=>setParams({task:'gate'},{replace:true}):home} presentation={presentation}/>;
  if(item)return <ProgressiveSetupFrame presentation={presentation} backTo="/more/setup" onBack={home} focusKey={item.capability}>
    <SetupHeader capability={item.capability} title={item.label} description={item.operation||item.timetable_operation?capabilityReadinessPresentation(item).description:undefined}/>
    {item.missing[0]?<section className="progressive-setup__handoff" aria-label="Next setup step"><h2>{item.missing[0].label}</h2><p>{item.missing[0].reason}</p>
      <Link className="campus-start__primary" aria-label={`Continue to ${item.missing[0].label}`} to={item.missing[0].destination}>Continue<ArrowRight size={18}/></Link>
    </section>:<Link className="campus-start__primary" to={item.destination}>{capabilityReadinessPresentation(item).action}<ArrowRight size={18}/></Link>}
    {item.missing.length>1?<section className="progressive-setup__prerequisites" aria-label="Other setup requirements"><h2>Also needed</h2><ul>{item.missing.slice(1).map(missing=><li key={missing.key}><Link className="progressive-setup__requirement" to={missing.destination}><span><strong>{missing.label}</strong><small>{missing.reason}</small></span><ChevronRight size={18}/></Link></li>)}</ul></section>:null}
    {item.status==='working'&&task==='gate'?<button type="button" className="campus-start__quiet" onClick={()=>setParams({task:'gate',configure:'gate'})}>Set up another entry point</button>:item.status==='working'&&task==='attendance'?<Link className="campus-start__quiet" to="/areas/timetable/planning?create=attendance">Schedule an activity</Link>:null}
    <Link className="campus-start__explore" to="/today">Set up later</Link>
  </ProgressiveSetupFrame>;
  return <ProgressiveSetupFrame presentation={presentation} backTo="/more/setup" focusKey="setup-hub" busy={saving}><SetupHeader title={setup.data.working_now.length?'Your campus setup':'Choose your next step'} description="Start with what you need today. Add more when it becomes useful."/>
    <Link className="progressive-setup__requirement" to="/more/setup/whole-campus" aria-disabled={saving||undefined}><ProductIcon name="building" size={28}/><span><strong>Set up the whole campus</strong><small>Build a campus view, connect useful places and add detail as you go.</small></span><ChevronRight size={18} aria-hidden="true"/></Link>
    <CapabilityGroup title="Working now" items={setup.data.working_now} disabled={saving}/>
    <CapabilityGroup title="Useful next" items={setup.data.useful_next} disabled={saving}/>
    <details className="progressive-setup__options"><summary>More campus options<ChevronRight size={18} aria-hidden="true"/></summary>
      <CapabilityGroup title="Available anytime" items={setup.data.available_anytime} disabled={saving}/>
      <Link className="campus-start__quiet" to="/onboarding/start" aria-disabled={saving||undefined}>Change my starting points</Link>
      <section className="progressive-setup__profile" aria-label="Campus name and verification"><h2>Campus details</h2>
        <button type="button" className="campus-start__quiet" disabled={saving} aria-expanded={profileOpen} aria-controls="setup-campus-name" onClick={()=>setProfileOpen(!profileOpen)}>{workspace.data?.workspace?.profile_named?'Edit campus name':'Add your campus name'}</button>
        {profileOpen?<form id="setup-campus-name" onSubmit={event=>void rename(event)} aria-busy={saving}><label className="campus-start__field">Campus name<input name="name" disabled={saving} minLength={2} maxLength={180} required defaultValue={workspace.data?.workspace?.profile_named?workspace.data.workspace.display_name:''} placeholder="The name your people recognise" autoComplete="organization"/></label><button className="campus-start__secondary" disabled={saving}>{saving?'Saving…':'Save name'}</button>{profileError?<p className="campus-start__error" role="alert">{profileError}</p>:null}</form>:null}
        <Link className="progressive-setup__requirement" to="/more/verification" aria-disabled={saving||undefined}><ShieldCheck size={21} aria-hidden="true"/><span><strong>Organisation verification</strong><small>Not needed for private campus work.</small></span><ChevronRight size={18} aria-hidden="true"/></Link>
      </section>
    </details>
    <Link className="campus-start__explore" to="/today" aria-disabled={saving||undefined}>Set up later</Link>
  </ProgressiveSetupFrame>;
}
function CapabilityGroup({title,items,disabled=false}:{title:string;items:CapabilityReadiness[];disabled?:boolean}){
  if(!items.length)return null;
  return <section className="progressive-setup__group" aria-label={title}><h2>{title}</h2><ul className="progressive-setup__tiles">{items.map(item=><li key={item.capability}>
    <Link className="progressive-setup__tile" aria-disabled={disabled||undefined} to={item.capability==='fees'?item.fees_operation?.destination??'/areas/fees/ledger':item.capability==='resources'?item.resources_operation?.destination??'/areas/resources':item.capability==='assignments'?'/areas/messages/assignments':item.status==='working'||item.timetable_operation&&item.timetable_operation.action!=='unavailable'?item.destination:`/more/setup/capabilities?task=${item.capability}`}>
      <span className="progressive-setup__tile-icon"><ProductIcon name={goalIconNames[item.capability]} size={32}/><ChevronRight size={18} aria-hidden="true"/></span>
      <span><strong>{item.label}</strong><small>{capabilityReadinessPresentation(item).description}</small></span>
    </Link>
  </li>)}</ul></section>;
}

type SetupProps={school:string;data:ProgressiveSetup;onComplete:(value:SetupResult)=>Promise<void>;onBack:()=>void};
function GateStart({school,data,onComplete,onBack,presentation}:SetupProps&{presentation:SetupPresentation}) {
  const auth=useAuth();const [gate,setGate]=useState('Main entrance');const [existing,setExisting]=useState('');const [operator,setOperator]=useState('self');const [confirmed,setConfirmed]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');try{await onComplete(await prepareCapability(school,'gate',{...(existing?{existing_gate_id:existing}:{gate_name:gate}),operator:operator==='self'?{kind:'current_user',confirm:true}:{kind:'staff',user_id:operator}}));}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}
  return <ProgressiveSetupFrame presentation={presentation} backTo="/more/setup/capabilities" onBack={onBack} busy={busy} focusKey="gate-setup">
    <SetupHeader capability="gate" title="Set up entry & exit" description="Choose an entry point and its operator."/>
    <form className="progressive-setup__gate-form" onSubmit={event=>void submit(event)} aria-busy={busy}>
      <fieldset className="campus-start__form-fields" disabled={busy}>
        <legend className="progressive-setup__field-group-label">Entry point</legend>
        {data.options.gates.length?<label className="campus-start__field">Entry point<select value={existing} onChange={event=>setExisting(event.target.value)}><option value="">Create an entry point</option>{data.options.gates.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>:null}
        {!existing?<label className="campus-start__field">Entry point name<input value={gate} onChange={event=>setGate(event.target.value)} minLength={2} maxLength={160} required/></label>:null}
      </fieldset>
      <fieldset className="campus-start__form-fields" disabled={busy}>
        <legend className="progressive-setup__field-group-label">Operator responsibility</legend>
        <label className="campus-start__field">Who will operate it?<select value={operator} onChange={event=>{setOperator(event.target.value);setConfirmed(false);}}><option value="self">I will</option>{data.options.staff.filter(item=>item.id!==auth.user?.id).map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        {operator==='self'?<label className="campus-start__checkfield"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} required/><span>I will operate this entry point and record arrivals and departures using my administrator access.</span></label>:<p className="campus-start__note"><strong>{data.options.staff.find(item=>item.id===operator)?.label??'The selected staff member'}</strong> will receive gatekeeper responsibility.</p>}
      </fieldset>
      {error?<p className="campus-start__error" role="alert">{error}</p>:null}
      <button className="campus-start__primary" disabled={busy}>{busy?'Preparing your entry point…':existing?'Set up entry point':'Create entry point'}<ArrowRight size={18}/></button>
    </form>
    <div className="progressive-setup__support">
      <Link className="campus-start__explore" to="/today" aria-disabled={busy||undefined} onClick={event=>{if(busy)event.preventDefault();}}>Set up later</Link>
      <details><InfoSummary>Visitor records</InfoSummary><p>Visitors don’t need an app account. No class or student record is required.</p></details>
    </div>
  </ProgressiveSetupFrame>;
}

export function ProgressiveSetupWorkspacePage(){return <ProgressiveSetupPage presentation="workspace"/>;}
