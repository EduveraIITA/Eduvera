import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter,Route,Routes,useLocation} from 'react-router-dom';
import {LoginPage} from './AuthPages';

const {loginMock}=vi.hoisted(()=>({loginMock:vi.fn()}));
vi.mock('./AuthContext',()=>({
  useAuth:()=>({status:'anonymous',demoMode:true,serviceError:null,login:loginMock}),
  authDestination:()=>'/principal',
}));

afterEach(()=>{cleanup();loginMock.mockReset();});

function Destination(){
  const location=useLocation();
  return <p>{location.pathname}{location.search}</p>;
}

it('opens the four-profile review screen before a protected next route',async()=>{
  loginMock.mockResolvedValue({challengeToken:null,demoProfileSwitcher:true});
  render(<MemoryRouter initialEntries={['/login?next=%2Fprincipal%2Fassistant']}><Routes>
    <Route path="/login" element={<LoginPage/>}/>
    <Route path="/account/profile" element={<Destination/>}/>
    <Route path="/principal/assistant" element={<p>Protected destination</p>}/>
  </Routes></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Email or username'),'meera.principal');
  await userEvent.type(screen.getByLabelText(/password/i,{selector:'input'}),'private-test-password');
  await userEvent.click(screen.getByRole('button',{name:/^Sign in/}));
  expect(await screen.findByText('/account/profile?demo_profiles=1')).toBeInTheDocument();
  expect(screen.queryByText('Protected destination')).not.toBeInTheDocument();
});

it('honours the protected next route for ordinary accounts',async()=>{
  loginMock.mockResolvedValue({challengeToken:null,demoProfileSwitcher:false});
  render(<MemoryRouter initialEntries={['/login?next=%2Fprincipal%2Fassistant']}><Routes>
    <Route path="/login" element={<LoginPage/>}/>
    <Route path="/account/profile" element={<Destination/>}/>
    <Route path="/principal/assistant" element={<p>Protected destination</p>}/>
  </Routes></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Email or username'),'ordinary.user');
  await userEvent.type(screen.getByLabelText(/password/i,{selector:'input'}),'private-test-password');
  await userEvent.click(screen.getByRole('button',{name:/^Sign in/}));
  expect(await screen.findByText('Protected destination')).toBeInTheDocument();
});
