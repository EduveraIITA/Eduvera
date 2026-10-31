import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../lib/api';
import JoinPage from './JoinPage';

const auth = vi.hoisted(() => ({ status: 'anonymous', user: null as { id: string; email: string } | null,
  memberships: [] as Array<{ school_id: string; school_name: string }>, executionEnvironment: { mode: 'live' }, refresh: vi.fn(), logout: vi.fn() }));
vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), apiFetch: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => auth, authDestination: () => '/today' }));
const campusId = '22d09fe4-a034-4526-ac31-ae882e876460';
const ready = { campus: { id: campusId, name: 'Aaranya' }, verification_required: false, delivery: 'not_required' };
const accepted = { school_id: campusId, role: 'member', accepted_user_id: 'recipient' };
beforeEach(() => {
  vi.clearAllMocks(); auth.status = 'anonymous'; auth.user = null; auth.memberships = []; auth.executionEnvironment = { mode: 'live' };
  vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(path === '/api/v1/invitations/recipient-proof/' ? ready : path === '/api/v1/invitations/accept/' ? accepted : {}));
});
afterEach(cleanup);
function Location() { const location = useLocation(); return <span data-testid="location">{location.pathname}{location.search}{location.hash}</span>; }
function show(path = '/join#email=aarav%40example.test&token=012345') { return render(<MemoryRouter initialEntries={[path]}><JoinPage /><Location /></MemoryRouter>); }
async function details() { await userEvent.click(screen.getByRole('button', { name: 'Continue' })); await screen.findByLabelText('Name'); }
async function fill() { await userEvent.type(screen.getByLabelText('Name'), 'Aarav Sharma'); await userEvent.type(screen.getByLabelText('Password'), 'Private!RiverStone2026'); }

describe('contextual campus invitation entry', () => {
  it('opens a fresh invitation in an already open Join tab without retaining the previous recipient form', async () => {
    render(<MemoryRouter initialEntries={['/join#email=aarav%40example.test&token=012345']}><JoinPage /><Location /><Link to="/join#email=sana%40example.test&token=654321">Open another invitation</Link></MemoryRouter>);
    await details(); await fill();
    await userEvent.click(screen.getByRole('link', { name: 'Open another invitation' }));
    expect(await screen.findByLabelText('Email')).toHaveValue('sana@example.test');
    expect(screen.getByLabelText('Invitation code')).toHaveValue('654321');
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).not.toHaveTextContent('#');
    expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path.endsWith('recipient-proof/'))).toHaveLength(1);
  });
  it('scrubs the fragment and checks an invitation only after Continue, without creating an account', async () => {
    show();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByLabelText('Invitation code')).toHaveValue('012345');
    expect(screen.getByLabelText('Invitation code')).not.toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/join$/);
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument(); expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
    await details();
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/v1/auth/csrf/');
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/v1/invitations/recipient-proof/', { method: 'POST', body: JSON.stringify({ email: 'aarav@example.test', token: '012345' }) });
    expect(screen.getByRole('heading', { name: 'Join Aaranya' })).toBeVisible();
    expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path === '/api/v1/invitations/accept/')).toBe(false);
  });
  it('asks for independent mailbox proof only when required and never substitutes the invitation code', async () => {
    vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(path.endsWith('recipient-proof/') ? { ...ready, verification_required: true, delivery: 'email_accepted', retry_after_seconds: 60 } : path.endsWith('accept/') ? accepted : {}));
    show(); await details(); await fill();
    expect(screen.getByLabelText('Email verification code')).toHaveValue('');
    expect(screen.getByText(/not the invitation code/)).toBeVisible();
    expect(screen.getByRole('button', { name: /Send again in/ })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Email verification code'), '839271');
    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Campus work is available only when assigned');
    const request = vi.mocked(apiFetch).mock.calls.find(([path]) => path.endsWith('accept/'))!;
    expect(JSON.parse(request[1]!.body as string)).toMatchObject({ token: '012345', recipient_proof: '839271', first_name: 'Aarav Sharma', last_name: '' });
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/join$/);
    expect(screen.queryByText('839271')).not.toBeInTheDocument(); expect(screen.queryByText('012345')).not.toBeInTheDocument();
  });
  it('uses one unchanged Name and the existing verified account password without an extra proof field', async () => {
    show(); await details();
    const name = '李 明  Sharma';
    await userEvent.type(screen.getByLabelText('Name'), name); await userEvent.type(screen.getByLabelText('Password'), 'Current!Password2026');
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument(); expect(screen.queryByLabelText('Last name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Email verification code')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    const request = vi.mocked(apiFetch).mock.calls.find(([path]) => path.endsWith('accept/'))!;
    expect(JSON.parse(request[1]!.body as string)).toEqual({ token: '012345', email: 'aarav@example.test', first_name: name, last_name: '', password: 'Current!Password2026' });
  });
  it('retains manual invitation input when lookup fails and allows retry', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Invitation expired. Ask for a new invitation.'));
    show('/join#email=invalid&token=123');
    await userEvent.type(screen.getByLabelText('Email'), 'aarav@example.test'); await userEvent.type(screen.getByLabelText('Invitation code'), '012345');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invitation expired');
    expect(screen.getByLabelText('Email')).toHaveValue('aarav@example.test'); expect(screen.getByLabelText('Invitation code')).toHaveValue('012345');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
  it('does not claim success or allow acceptance when required email sending is unavailable', async () => {
    vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(path.endsWith('recipient-proof/') ? { ...ready, verification_required: true, delivery: 'unavailable' } : {}));
    show(); await details();
    expect(screen.getByRole('alert')).toHaveTextContent('Email sending is unavailable');
    expect(screen.getByRole('button', { name: 'Accept invitation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send code again' })).toBeEnabled();
    expect(screen.queryByText(/code sent/i)).not.toBeInTheDocument();
  });
  it('retains entered details after refusal and requests admin person confirmation only when the API requires it', async () => {
    vi.mocked(apiFetch).mockImplementation(path => {
      if (path.endsWith('recipient-proof/')) return Promise.resolve(ready);
      if (path.endsWith('accept/')) return Promise.reject(new ApiError('Confirm your campus person profile.', 409, { error: { code: 'admin_person_confirmation_required' } }));
      return Promise.resolve({});
    });
    show(); await details(); await fill();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Confirm your campus person profile');
    expect(screen.getByRole('checkbox', { name: /I confirm this name/ })).toBeRequired();
    expect(screen.getByLabelText('Name')).toHaveValue('Aarav Sharma'); expect(screen.getByLabelText('Password')).toHaveValue('Private!RiverStone2026');
    await userEvent.click(screen.getByRole('checkbox'));
    vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(path.endsWith('accept/') ? { ...accepted, role: 'admin' } : {}));
    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('status')).toHaveTextContent('campus membership is active');
    expect(JSON.parse(vi.mocked(apiFetch).mock.calls.at(-1)![1]!.body as string)).toMatchObject({ confirm_admin_person: true });
  });
  it('keeps recovery in a new tab and changing the invitation clears sensitive fields', async () => {
    show(); await details(); await fill();
    const recovery = within(screen.getByLabelText('Password').closest('form')!).getByRole('link', { name: 'Reset password in a new tab' });
    expect(recovery).toHaveAttribute('target', '_blank'); expect(recovery).toHaveAttribute('rel', 'noopener noreferrer'); expect(recovery).toHaveAttribute('href', '/forgot-password');
    await userEvent.click(screen.getByRole('button', { name: 'Change invitation' }));
    expect(screen.getByLabelText('Email')).toHaveValue('aarav@example.test'); await details();
    expect(screen.getByLabelText('Password')).toHaveValue(''); expect(screen.getByLabelText('Name')).toHaveValue('Aarav Sharma');
  });
  it('does not log out the same accepted account and selects only the accepted campus', async () => {
    auth.status = 'authenticated'; auth.user = { id: 'recipient', email: 'aarav@example.test' };
    show(); await details(); await fill(); await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open campus' }));
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/auth/active-school/', { method: 'POST', body: JSON.stringify({ school_id: campusId }) });
    expect(auth.refresh).toHaveBeenCalledTimes(2); expect(auth.logout).not.toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/work');
  });
  it('keeps invitation success distinct from a failed campus handoff and never accepts twice', async () => {
    auth.status = 'authenticated'; auth.user = { id: 'recipient', email: 'aarav@example.test' };
    vi.mocked(apiFetch).mockImplementation(path => { if (path.endsWith('recipient-proof/')) return Promise.resolve(ready); if (path.endsWith('accept/')) return Promise.resolve(accepted); if (path.endsWith('active-school/')) return Promise.reject(new Error('Campus selection is unavailable. Try again.')); return Promise.resolve({}); });
    show(); await details(); await fill(); await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open campus' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Campus selection is unavailable');
    expect(screen.getByRole('status')).toHaveTextContent('account is linked');
    await userEvent.click(screen.getByRole('button', { name: 'Open campus' }));
    expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path.endsWith('accept/'))).toHaveLength(1);
  });
  it('does not silently switch the wrong signed-in account and uses a safe campus-only login continuation', async () => {
    auth.status = 'authenticated'; auth.user = { id: 'other', email: 'other@example.test' };
    show(); await details(); await fill(); await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByText(/You’re still signed in as other/)).toBeVisible(); expect(auth.logout).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with invited account' }));
    expect(auth.logout).toHaveBeenCalledOnce();
    expect(screen.getByTestId('location')).toHaveTextContent(`/login?next=${encodeURIComponent(`/join?campus=${campusId}`)}`);
    expect(screen.getByTestId('location')).not.toHaveTextContent('012345');
  });
  it('rechecks an existing membership before opening a campus-only continuation', async () => {
    auth.status = 'authenticated'; auth.user = { id: 'recipient', email: 'aarav@example.test' }; auth.memberships = [{ school_id: campusId, school_name: 'Aaranya' }];
    show(`/join?campus=${campusId}`);
    expect(apiFetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Open campus' }));
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/auth/active-school/', { method: 'POST', body: JSON.stringify({ school_id: campusId }) });
    expect(screen.getByTestId('location')).toHaveTextContent('/work');
  });
  it('treats a campus query without matching membership as no authority and offers explicit account recovery', async () => {
    auth.status = 'authenticated'; auth.user = { id: 'other', email: 'other@example.test' };
    vi.mocked(apiFetch).mockResolvedValue({ user: { id: 'other' }, memberships: [] });
    show(`/join?campus=${campusId}`);
    expect(await screen.findByText(/no current access/)).toBeVisible(); expect(apiFetch).toHaveBeenCalledOnce(); expect(vi.mocked(apiFetch).mock.calls[0][0]).toBe('/api/v1/auth/me/'); expect(vi.mocked(apiFetch).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal); expect(auth.logout).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Use another account' }));
    expect(auth.logout).toHaveBeenCalledOnce(); expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path.endsWith('active-school/'))).toBe(false);
  });
  it('checks an unknown acceptance result only on explicit request and does not repeat acceptance silently', async () => {
    let uncertain = true;
    vi.mocked(apiFetch).mockImplementation((path, init) => {
      if (path.endsWith('recipient-proof/')) return Promise.resolve(ready);
      if (path.endsWith('accept/')) {
        const body = JSON.parse(init!.body as string) as { recover_accepted?: boolean };
        if (uncertain) { uncertain = false; return Promise.reject(new Error('Network interrupted.')); }
        return body.recover_accepted ? Promise.resolve(accepted) : Promise.reject(new Error('An ordinary second acceptance is not permitted.'));
      }
      return Promise.resolve({});
    });
    show(); await details(); await fill(); await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByText(/Joining wasn’t confirmed/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).not.toBeInTheDocument();
    expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path.endsWith('accept/'))).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Check joining result' }));
    expect(await screen.findByText(/Your account is linked/)).toBeVisible();
    const requests = vi.mocked(apiFetch).mock.calls.filter(([path]) => path.endsWith('accept/'));
    expect(JSON.parse(requests[1][1]!.body as string)).toMatchObject({ recover_accepted: true, token: '012345', email: 'aarav@example.test' });
  });
  it('restores explicit acceptance when the server confirms the earlier request did not commit', async () => {
    vi.mocked(apiFetch).mockImplementation((path, init) => {
      if (path.endsWith('recipient-proof/')) return Promise.resolve(ready);
      if (path.endsWith('accept/')) {
        const body = JSON.parse(init!.body as string) as { recover_accepted?: boolean };
        return body.recover_accepted
          ? Promise.reject(new ApiError('Joining has not been confirmed.', 409, { error: { code: 'invitation_acceptance_not_confirmed' } }))
          : Promise.reject(new Error('Network interrupted.'));
      }
      return Promise.resolve({});
    });
    show(); await details(); await fill(); await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Check joining result' }));
    expect(await screen.findByRole('button', { name: 'Accept invitation' })).toBeVisible();
    expect(screen.getByLabelText('Name')).toHaveValue('Aarav Sharma');
    expect(screen.queryByRole('button', { name: 'Check joining result' })).not.toBeInTheDocument();
  });
  it('does not classify validation refusal or a failed CSRF read as an unknown accepted invitation', async () => {
    show(); await details(); await fill();
    vi.mocked(apiFetch).mockResolvedValueOnce({}).mockRejectedValueOnce(new ApiError('Password is incorrect.', 400));
    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Password is incorrect');
    expect(screen.queryByRole('button', { name: 'Check joining result' })).not.toBeInTheDocument();
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Connection unavailable.'));
    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection unavailable');
    expect(screen.queryByRole('button', { name: 'Check joining result' })).not.toBeInTheDocument();
  });
  it('offers working explicit sign-in recovery from an unknown result before any acceptance receipt exists', async () => {
    auth.status = 'authenticated'; auth.user = { id: 'other', email: 'other@example.test' };
    vi.mocked(apiFetch).mockImplementation(path => path.endsWith('recipient-proof/') ? Promise.resolve(ready) : path.endsWith('accept/') ? Promise.reject(new Error('Network interrupted.')) : Promise.resolve({}));
    show(); await details(); await fill(); await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Use sign-in recovery' }));
    expect(auth.logout).toHaveBeenCalledOnce();
    expect(screen.getByTestId('location')).toHaveTextContent(`/login?next=${encodeURIComponent(`/join?campus=${campusId}`)}`);
    expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path.endsWith('accept/'))).toHaveLength(1);
  });
  it('keeps real invitation effects unavailable in Simulation and scrubs credentials even on a continuation URL', () => {
    auth.executionEnvironment = { mode: 'simulation' };
    show(`/join?campus=${campusId}#email=aarav%40example.test&token=012345`);
    expect(screen.getByRole('heading', { name: 'Joining is managed in Live' })).toBeVisible();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).not.toHaveTextContent('#');
    expect(apiFetch).not.toHaveBeenCalled(); expect(auth.logout).not.toHaveBeenCalled();
  });
  it('can continue to an authorised second campus even when the shell contains only the previous campus', async () => {
    auth.status = 'authenticated'; auth.user = { id: 'recipient', email: 'aarav@example.test' };
    auth.memberships = [{ school_id: 'previous-campus', school_name: 'Previous campus' }];
    vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(path.endsWith('me/') ? { user: { id: 'recipient' }, memberships: [...auth.memberships, { school_id: campusId, school_name: 'Aaranya' }] } : {}));
    show(`/join?campus=${campusId}`);
    expect(await screen.findByRole('heading', { name: 'Open Aaranya' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Open campus' }));
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/auth/active-school/', { method: 'POST', body: JSON.stringify({ school_id: campusId }) });
    expect(screen.getByTestId('location')).toHaveTextContent('/work');
  });
  it('keeps a failed access check distinct from no access and provides retry', async () => {
    auth.status = 'authenticated'; auth.user = { id: 'recipient', email: 'aarav@example.test' };
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Access check unavailable.'));
    show(`/join?campus=${campusId}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('Access check unavailable');
    expect(screen.queryByText(/no current access/)).not.toBeInTheDocument();
    vi.mocked(apiFetch).mockResolvedValue({ user: { id: 'recipient' }, memberships: [{ school_id: campusId, school_name: 'Aaranya' }] });
    await userEvent.click(screen.getByRole('button', { name: 'Retry access check' }));
    expect(await screen.findByRole('heading', { name: 'Open Aaranya' })).toBeVisible();
  });
});
