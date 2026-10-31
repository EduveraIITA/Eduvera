import { ArrowLeft, LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandLogo } from '../../components/BrandLogo';
import { AppearanceMenu } from '../appearance/AppearanceMenu';
import './progressive-onboarding.css';

export function OnboardingFrame({children,onBack,onLogout,backTo,step,headerAction,progress,busy=false}:{children:ReactNode;onBack?:()=>void;onLogout?:()=>void;backTo?:string;step?:string;headerAction?:ReactNode;progress?:{current:number;total:number};busy?:boolean}) {
  return <main className="campus-start"><header className="campus-start__header">
    <div>{onBack ? <button className="campus-start__back" type="button" disabled={busy} onClick={onBack} aria-label="Back"><ArrowLeft size={22}/></button>:null}<Link to={backTo??'/'} aria-label="ThatCampus home" aria-disabled={busy||undefined} onClick={event=>{if(busy)event.preventDefault();}}><BrandLogo/></Link></div>
    <div>{headerAction??(backTo?<Link className="campus-start__quiet" to={backTo} aria-disabled={busy||undefined} onClick={event=>{if(busy)event.preventDefault();}}>Done</Link>:onLogout?<button className="campus-start__quiet" type="button" disabled={busy} onClick={onLogout}><LogOut size={16}/>Sign out</button>:null)}<AppearanceMenu/></div>
  </header><div className="campus-start__body"><div className="campus-start__wayfinding"><span>{progress?`Step ${progress.current} of ${progress.total}`:'Get started'}</span>{step?<span>{step}</span>:null}</div>{children}</div></main>;
}
