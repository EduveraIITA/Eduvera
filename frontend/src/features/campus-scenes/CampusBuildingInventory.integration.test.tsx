import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { CampusScenePublishedView } from './CampusScenePublishedView';
import { getCampusSceneResources, type CampusScenePublished } from './api';
import type { CampusSceneOperationsBridge } from './sceneOperations.types';

vi.mock('../auth/AuthContext',()=>({useOptionalAuth:()=>({user:{id:'admin',active_school_id:'school'},memberships:[{school_id:'school',role:'admin'}]})}));
vi.mock('./api',async original=>({...await original<typeof import('./api')>(),getCampusSceneResources:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('withdraws successful private room quantities as soon as current campus oversight is lost',async()=>{
  vi.mocked(getCampusSceneResources).mockResolvedValue({items:[{id:'seating',name:'Recorded office seating',quantity:6,tracking_mode:'pooled',unit_label:'chairs',asset_tag:null,space_id:'office',state:'available'}],selected:null,page:1,page_size:20,total:1});
  const data:CampusScenePublished={campus:{id:'campus',name:'Campus',code:'C'},can_edit:true,
    places:[{id:'b',name:'Administration',code:'B',kind:'other',parent_space_id:null},{id:'floor',name:'Ground floor',code:'0',kind:'floor',parent_space_id:'b'},{id:'office',name:'Office',code:'O',kind:'office',parent_space_id:'floor'}],
    scene:{id:'publication',version:1,published_at:'2026-10-27T00:00:00Z',document:{schema_version:1,name:'Campus',source:{kind:'manual',label:'Reviewed'},bounds:{width:100,height:100,unit:'metres'},elements:[
      {id:'building',kind:'building',label:'Administration',space_id:'b',floor_id:null,review_state:'reviewed',geometry:{type:'polygon',points:[{x:10,y:10},{x:80,y:10},{x:80,y:60},{x:10,y:60}]}},
      {id:'room',kind:'room',label:'Office',space_id:'office',floor_id:'floor',parent_element_id:'building',review_state:'reviewed',geometry:{type:'polygon',points:[{x:20,y:20},{x:40,y:20},{x:40,y:40},{x:20,y:40}]}}
    ]}}};
  const bridge:CampusSceneOperationsBridge={placesState:'available',places:data.places.map(p=>({...p,campus_id:'campus'})),markersFor:()=>[],selectedSpaceId:null,selectedMarkerId:null,unavailableFixtureIds:[],onSelectPlace:vi.fn(),onInspectPlace:vi.fn(),onSelectMarker:vi.fn(),controls:null};
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const view=(operations?:CampusSceneOperationsBridge)=><QueryClientProvider client={client}><CampusScenePublishedView schoolId="school" data={data} operations={operations}/></QueryClientProvider>;
  const rendered=render(view(bridge));
  fireEvent.keyDown(screen.getByRole('button',{name:'Administration, building'}),{key:'Enter'});
  fireEvent.click(screen.getByRole('button',{name:'Show Office on map'}));
  expect(await screen.findByText('Recorded office seating')).toBeVisible();
  rendered.rerender(view({...bridge,placesState:'unavailable',places:[]}));
  expect(screen.queryByText('Recorded office seating')).toBeNull();
  expect(screen.queryByRole('region',{name:'Room inventory'})).toBeNull();
  expect(screen.getByRole('button',{name:'Office, room'})).toBeVisible();
  rendered.rerender(view());
  expect(screen.queryByRole('region',{name:'Room inventory'})).toBeNull();
  expect(getCampusSceneResources).toHaveBeenCalledTimes(1);
});
