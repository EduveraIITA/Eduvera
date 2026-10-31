import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useExecutionEnvironment } from '../simulation/ExecutionEnvironmentContext';
import { OnboardingFrame } from './OnboardingFrame';
import { ConnectedCampus, StartingPoints } from './StartingPoints';
import { createPrivateWorkspace, getProgressiveWorkspace, saveStartingGoals, type GoalKey, type ProgressiveWorkspace } from './progressive-api';

export default function SelfServiceOnboardingPage() {
  const auth=useAuth();
  const environment=useExecutionEnvironment();
  const query=useQuery({queryKey:['onboarding','progressive',auth.user?.id],queryFn:getProgressiveWorkspace,enabled:environment.mode==='live'});
  if(auth.companyOperator)return <Navigate to="/company" replace/>;
  if(environment.mode==='simulation')return <OnboardingFrame><h1>Set up your campus in Live</h1><p className="campus-start__lead">You’re viewing a Simulation. Account and starting-point setup belong to Live; no campus will be created or changed here.</p><Link className="campus-start__primary" to="/more/simulation">Open Simulation controls<ArrowRight size={19}/></Link><p className="campus-start__note">Return to Live there when you want to continue setup.</p></OnboardingFrame>;
  if(query.isPending)return <OnboardingFrame><p role="status">Getting your starting points ready…</p></OnboardingFrame>;
  if(query.isError)return <OnboardingFrame><h1>Let’s try that again.</h1><p role="alert">{query.error.message}</p><button className="campus-start__primary" onClick={()=>void query.refetch()}>Retry</button></OnboardingFrame>;
  if(!query.data.catalogue.some(item=>item.selection_kind==='goal'))return <OnboardingFrame><h1>Your starting points couldn’t load</h1><p className="campus-start__lead">Try again to choose what you want to run. No new workspace has been created.</p><button className="campus-start__primary" onClick={()=>void query.refetch()}>Retry</button><Link className="campus-start__explore" to="/demo">Explore the demo</Link></OnboardingFrame>;
  return <PurposeJourney key={query.data.workspace?.id??'new'} data={query.data}/>;
}
function PurposeJourney({data}:{data:ProgressiveWorkspace}) {
  const auth=useAuth();const navigate=useNavigate();const cache=useQueryClient();const [params,setParams]=useSearchParams();
  const [selected,setSelected]=useState<GoalKey[]>(()=>{const draft=params.get('goals')?.split(',').filter(key=>data.catalogue.some(item=>item.selection_kind==='goal'&&item.key===key)) as GoalKey[]|undefined;return draft?.length?draft:data.goals.selected;});
  const [primary,setPrimary]=useState<GoalKey|''>(data.goals.primary??'');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const connected=params.get('step')==='connect'&&selected.length>0;const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();},[connected]);
  const first=selected.includes(primary as GoalKey)?primary as GoalKey:selected[0];
  function choose(value:GoalKey[]){setSelected(value);setParams({goals:value.join(',')},{replace:true});}
  function step(value:string){setParams({step:value,goals:selected.join(',')});setError('');}
  async function start(){if(!first)return;setBusy(true);setError('');try{const ordered=[first,...selected.filter(item=>item!==first)];if(data.workspace&&data.status!=="purpose_required")await saveStartingGoals(ordered,first);else await createPrivateWorkspace({goals:ordered,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});await auth.refresh();await cache.invalidateQueries({queryKey:['onboarding']});void navigate(`/more/setup/capabilities?task=${first}`,{replace:true});}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}
  async function startWholeCampus(){if(busy)return;setBusy(true);setError('');try{await createPrivateWorkspace({guidance:'whole_campus',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});await auth.refresh();await cache.invalidateQueries({queryKey:['onboarding']});void navigate('/more/setup/whole-campus',{replace:true});}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}
  return <OnboardingFrame busy={busy} progress={{current:connected?2:1,total:2}} step={connected?'Review your starting point':'Choose your starting points'} onBack={connected?()=>step('purpose'):undefined} onLogout={()=>void auth.logout()} backTo={data.workspace&&data.status==="ready"?'/more/setup/capabilities':undefined}>
    <h1 ref={heading} tabIndex={-1}>{connected?'Your campus starts here':'What would you like to run?'}</h1>
    <p className="campus-start__lead">{connected?selected.length>1?'Choose your first activity. The rest stays ready to add.':'One task to begin. Shared people and records as you grow.':'Choose one or several. This only decides where we start — every capability stays available.'}</p>
    {connected?<><ConnectedCampus catalogue={data.catalogue} selected={selected} priority={first} onPriority={setPrimary} disabled={busy}/><button className="campus-start__primary" disabled={busy} onClick={()=>void start()}>{busy?'Preparing your workspace…':`Start with ${data.catalogue.find(item=>item.key===first)?.label.toLowerCase()}`}<ArrowRight size={19}/></button></>:<><StartingPoints catalogue={data.catalogue} selected={selected} onChange={choose} onWholeCampus={()=>void startWholeCampus()} disabled={busy}/><button className="campus-start__primary" disabled={busy||!selected.length} onClick={()=>step('connect')}>{busy?'Preparing your campus guide…':`Continue${selected.length?` · ${selected.length} selected`:''}`}<ArrowRight size={19}/></button><Link className="campus-start__explore" to="/demo" aria-disabled={busy||undefined} onClick={event=>{if(busy)event.preventDefault();}}>Just looking? Explore the demo</Link><p className="campus-start__note">Joining someone else’s campus? <Link to="/join" aria-disabled={busy||undefined} onClick={event=>{if(busy)event.preventDefault();}}>Use your invitation</Link>.</p></>}
    {error?<p className="campus-start__error" role="alert">{error}</p>:null}
  </OnboardingFrame>;
}
