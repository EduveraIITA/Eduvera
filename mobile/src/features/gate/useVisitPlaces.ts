import { useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useSession } from '../../auth/SessionProvider';
import { apiFetch, captureApiContext } from '../../lib/api';
import { loadVisitPlaceCatalogue, loadVisitSchedule, visitScheduleRange, type VisitSchedulePage, type VisitTimeWindow } from '../../lib/visit-place-presentation';
import type { VisitOptions } from '../../../../packages/contracts/src/wire/features/gate/visitApi';
import type { CampusSceneDirectory, CampusScenePublished } from '../../../../packages/contracts/src/campus-scenes/contracts';
import { nativeCampusPublicationMatches } from '../../lib/native-campus';

export function useVisitCampuses(schoolId:string) {
  const session=useSession(),focused=useIsFocused();
  return useQuery({queryKey:['campus',session.scopeKey,'visit-published-campuses',schoolId],enabled:focused&&session.status==='authenticated'&&!session.environment.unavailable,retry:false,staleTime:60000,queryFn:async({signal})=>{
    const lease=captureApiContext(),root=`/api/v1/schools/${encodeURIComponent(schoolId)}/campus-scenes`,directory=await apiFetch<CampusSceneDirectory>(`${root}/`,{signal});lease.assertCurrent();
    const publications:CampusScenePublished[]=[];
    for(const campus of directory.campuses){const data=await apiFetch<CampusScenePublished>(`${root}/${encodeURIComponent(campus.id)}/published/`,{signal});lease.assertCurrent();if(!nativeCampusPublicationMatches(data,campus.id))throw new Error('The published campus could not be verified.');publications.push(data);}
    return{directory,publications};
  }});
}

export function useVisitPlaces(root: string) {
  const session=useSession(),focused=useIsFocused();
  return useQuery({queryKey:['campus',session.scopeKey,`${root}/complete-place-choices`],enabled:focused&&session.status==='authenticated'&&!session.environment.unavailable,staleTime:60000,retry:false,
    queryFn:async({signal})=>{const lease=captureApiContext();return loadVisitPlaceCatalogue(async page=>{lease.assertCurrent();const data=await apiFetch<VisitOptions>(`${root}/options/?page=${page}`,{signal});lease.assertCurrent();return data;});}});
}
export function useVisitSchedule(schoolId: string, window?: VisitTimeWindow) {
  const session=useSession(),focused=useIsFocused(),range=visitScheduleRange(window);
  return useQuery({queryKey:['campus',session.scopeKey,'visit-place-schedule',schoolId,range],enabled:focused&&!!range&&session.status==='authenticated'&&!session.environment.unavailable,staleTime:30000,retry:false,
    queryFn:async({signal})=>{const lease=captureApiContext();return loadVisitSchedule(async page=>{lease.assertCurrent();const data=await apiFetch<VisitSchedulePage>(`/api/v1/schools/${encodeURIComponent(schoolId)}/activities/occurrences?${new URLSearchParams({...range!,state:'expected',page:String(page)})}`,{signal});lease.assertCurrent();return data;});}});
}
