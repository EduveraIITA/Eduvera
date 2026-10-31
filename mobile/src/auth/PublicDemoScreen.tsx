import { useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSession } from './SessionProvider';
import type { PublicDemoRole } from './session-types';
import { apiFetch, getApiOrigin } from '../lib/api';
import { Button, Empty, Loading, Notice, Page, Row, Section } from '../ui/components';
import { ControlButton } from '../ui/DomainControls';
import { useTheme } from '../ui/theme';
import { DemoProfileSwitcher } from './DemoProfileSwitcher';

const profiles: Array<{ role: PublicDemoRole; name: string; label: string; detail: string }> = [
  {role:'admin',name:'Meera Kapoor',label:'Principal',detail:'School operations, attendance and insights.'},
  {role:'staff',name:'Kavita Mehta',label:'Teacher',detail:'Classes, registers and the teaching day.'},
  {role:'parent',name:'Pooja Sharma',label:'Parent',detail:'Attendance, requests and family updates.'},
  {role:'student',name:'Aarav Sharma',label:'Student',detail:'Schedules and schoolwork.'},
];
export function PublicDemoScreen() {
  const session = useSession(), router = useRouter(), { colors } = useTheme();
  const availability = useQuery({queryKey:['public-demo-config',getApiOrigin(),session.scopeKey],queryFn:({signal})=>apiFetch<{enabled:boolean}>('/api/v1/auth/public-demo-config/',{signal}),retry:false,staleTime:0});
  const [pending,setPending] = useState<PublicDemoRole | 'logout' | null>(null),[error,setError] = useState('');
  async function open(role:PublicDemoRole) {
    if(pending)return; setPending(role);setError('');
    try { await session.enterPublicDemo(role); router.replace('/today'); }
    catch(cause){setError(cause instanceof Error?cause.message:'The sample campus could not be opened.');setPending(null);}
  }
  return <><Stack.Screen options={{headerShown:true,title:'Sample campus',headerTintColor:colors.link,headerShadowVisible:false,contentStyle:{backgroundColor:colors.canvas}}}/><Page title="Explore ThatCampus" subtitle="The real application with synthetic campus data." maxWidth={720}>
    {session.status === 'loading' || availability.isPending ? <Loading/> : availability.isError || availability.data?.enabled !== true ? <><Empty title={availability.isError?'The sample campus could not be checked':'The sample campus is unavailable here'} message={availability.isError?availability.error.message:'Create your own account or sign in to an existing workspace.'} onRetry={availability.isError?()=>{void availability.refetch();}:undefined}/><ControlButton title={session.user?'Open my workspace':'Sign in'} onPress={()=>router.replace(session.user?'/today':'/login')}/>{!session.user?<ControlButton title="Create an account" onPress={()=>router.push('/signup')}/>:null}</> : session.user && !session.publicDemo ? <>
      <Notice message="Your work is saved. Sign out before exploring the isolated sample profiles."/>{error?<Notice tone="danger" message={error}/>:null}<Button title="Sign out and explore" busy={pending==='logout'} onPress={()=>{if(pending)return;setPending('logout');void session.logout().catch(cause=>setError(cause instanceof Error?cause.message:'Sign-out could not be confirmed.')).finally(()=>setPending(null));}}/><ControlButton title="Stay in my workspace" disabled={!!pending} onPress={()=>router.replace('/today')}/>
    </> : <><Notice message="Sample data · read-only. Record changes, uploads and AI are disabled in this public preview."/>{error?<Notice tone="danger" message={error}/>:null}{session.publicDemo ? <DemoProfileSwitcher /> : <Section title="Choose a view">{profiles.map(profile=><Section key={profile.role} title={profile.label}><Row title={profile.name} detail={profile.detail}/><Button title={`Explore as ${profile.label.toLowerCase()}`} busy={pending===profile.role} disabled={!!pending} onPress={()=>{void open(profile.role);}}/></Section>)}</Section>}<ControlButton title="Sign in with my account" disabled={!!pending} onPress={()=>{if(session.publicDemo){setPending('logout');void session.logout().then(()=>router.replace('/login')).catch(cause=>{setError(cause instanceof Error?cause.message:'Sign-out could not be confirmed.');setPending(null);});}else router.push('/login');}}/></>}
  </Page></>;
}
