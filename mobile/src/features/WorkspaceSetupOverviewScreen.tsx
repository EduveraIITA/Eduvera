import { useMemo } from 'react';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../packages/contracts/src/workspace-normalizer';
import { useSession } from '../auth/SessionProvider';
import { useApi } from '../lib/query';
import { workspaceSetupOverview } from '../lib/setup-overview';
import { ScreenBack } from '../ui/BackNavigation';
import { Empty, ListGroup, Loading, Notice, Page, Row, Section } from '../ui/components';
import { DomainText, type DomainScreenProps } from './ResourcesScreen';

/** Like MoreToolBoundary, setup uses the current exact manifest and owning API
 * authority. This root accepts any setup contribution, not only capabilities. */
export function WorkspaceSetupOverviewScreen({onNavigate}:DomainScreenProps){
  const session=useSession(),query=useApi<unknown>(session.user&&session.schoolId?'/api/v1/workspace':null);
  const overview=useMemo(()=>{try{if(!query.data||!session.user||!session.schoolId)return null;const manifest=normalizeWorkspaceManifest(query.data);assertWorkspaceManifestContext(manifest,{actorUserId:session.user.id,institutionId:session.schoolId,environment:session.environment});return workspaceSetupOverview(manifest);}catch{return null;}},[query.data,session.user?.id,session.schoolId,session.environment]);
  const refresh=()=>void query.refetch();
  return <Page title="Campus setup" refreshing={query.isRefetching} onRefresh={refresh}><ScreenBack fallbackHref="/more" title="More"/>
    {session.environment.unavailable?<Empty title="This Simulation is unavailable" message="Recover the selected world or return to Live before opening campus setup."/>:query.isPending?<Loading label="Loading your setup responsibilities…"/>:query.isError||!overview?<Empty title="Campus setup access could not be confirmed" message={query.error?.message??'Your current responsibilities do not include campus configuration.'} onRetry={refresh}/>:<>
      <Section title="Set up the next thing you need."><DomainText>Start with one useful outcome. ThatCampus reuses the same people, places, schedules and responsibilities as your campus grows.</DomainText></Section>
      {overview.capabilities?<><Row icon="building" title="Build your whole campus" detail="Start with a layout and a few useful places. Add people, rooms and services as you need them." onPress={()=>onNavigate('/more/setup/whole-campus')}/><Section title="Choose what should work next"><DomainText>See what is working now, the smallest useful next step and everything available later. Nothing is locked.</DomainText><Row icon="settings" title="Review capabilities" detail={overview.capabilities.label} onPress={()=>onNavigate(overview.capabilities!.href)}/></Section></>:null}
      {overview.foundation.length?<Section title="Connect only the essentials"><DomainText>Add a person, place, group or rule when an operation actually needs it.</DomainText><ListGroup>{overview.foundation.map(({item,detail,icon},index)=><Row key={item.key} variant="plain" separator={index>0} icon={icon} title={item.label} detail={detail} onPress={()=>onNavigate(item.href)}/>)}</ListGroup></Section>:!overview.capabilities?<Empty title="No setup work is assigned" message="Your current responsibilities do not include campus configuration."/>:null}
      <Notice message="Setup changes the same Live or Simulation campus shown everywhere else. It never creates a separate copy of people, classes or places."/>
    </>}
  </Page>;
}
