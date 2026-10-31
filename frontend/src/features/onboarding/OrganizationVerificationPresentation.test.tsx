import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { ExecutionEnvironmentProvider } from '../simulation/ExecutionEnvironmentContext';
import type { ExecutionEnvironment } from '../simulation/executionEnvironment';
import { submitInstitutionApplication, type InstitutionApplication } from './api';
import { getProgressiveWorkspace, type ProgressiveWorkspace } from './progressive-api';
import OrganizationVerificationPage from './OrganizationVerificationPage';

const back = vi.hoisted(() => vi.fn());
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), submitInstitutionApplication: vi.fn() }));
vi.mock('./progressive-api', async original => ({ ...await original<typeof import('./progressive-api')>(), getProgressiveWorkspace: vi.fn() }));
vi.mock('../../pages/operations/OperationsShell', () => ({ OperationsShell: ({ beforeBack, children }: { beforeBack?: () => boolean; children: ReactNode }) => <><button type="button" onClick={() => { if (beforeBack?.() !== false) back(); }}>Workspace Back</button><main>{children}</main></> }));

const snapshot: ProgressiveWorkspace = {
  status: 'ready', workspace: { id: 'campus', display_name: 'Your campus', profile_named: false, timezone: 'Asia/Kolkata', verification_status: 'not_required', onboarding_model: 'progressive_private' },
  goals: { selected: ['attendance'], primary: 'attendance' }, resume: { step: 'operating', goal: 'attendance', path: '/today' }, catalogue: [], applications: [],
};
const application: InstitutionApplication = {
  id: 'review', workspace_school_id: 'campus', institution_name: 'Lotus Learning', requested_code: 'lotus', institution_kind: 'coaching', timezone: 'Asia/Kolkata', state_code: 'KA', district: 'Bengaluru', website: '', applicant_role_title: 'Owner', regulator_type: 'trust_registration', regulator_reference: 'TR-2026', status: 'submitted', review_note: '', revision: 1, submitted_at: '2026-10-21T09:00:00Z', updated_at: '2026-10-21T09:00:00Z', provisioned_school_id: null,
};
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
function show({ environment = { mode: 'live' }, presentation = 'onboarding', cached }: { environment?: ExecutionEnvironment; presentation?: 'onboarding' | 'workspace'; cached?: ProgressiveWorkspace } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached) client.setQueryData(['onboarding', 'progressive', 'owner'], cached);
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={['/more/verification']}><OrganizationVerificationPage presentation={presentation} /><Location /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
  return client;
}
async function enterDetails() {
  await userEvent.click(await screen.findByRole('button', { name: 'Start verification' }));
  await userEvent.type(screen.getByLabelText('Registered organisation name'), 'Lotus Learning');
  await userEvent.type(screen.getByLabelText('State / region code'), 'KA');
  await userEvent.type(screen.getByLabelText('District / locality'), 'Bengaluru');
  await userEvent.type(screen.getByRole('textbox', { name: /^Registration or affiliation reference/ }), 'TR-2026');
  await userEvent.type(screen.getByLabelText('Your role in the organisation'), 'Owner');
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getProgressiveWorkspace).mockResolvedValue(snapshot); });
afterEach(cleanup);

describe('optional organisation verification presentation', () => {
  it('starts with one optional task, an honest status and an on-demand explanation', async () => {
    show();
    expect(await screen.findByRole('heading', { level: 1, name: 'Organisation verification' })).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(await screen.findByRole('region', { name: 'Not verified' })).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up later' })).toHaveAttribute('href', '/more/setup/capabilities');
    expect(screen.getByText(/does not create another workspace/)).not.toBeVisible();
    await userEvent.click(screen.getByText('About verification'));
    expect(screen.getByText(/does not create another workspace/)).toBeVisible();
    expect(submitInstitutionApplication).not.toHaveBeenCalled();
  });

  it('groups visible required fields, leaves website optional and restores entry focus on cancel', async () => {
    show(); await userEvent.click(await screen.findByRole('button', { name: 'Start verification' }));
    expect(screen.getByRole('heading', { name: 'Organisation details' })).toHaveFocus();
    for (const label of ['Your organisation', 'Registration reference', 'Your declaration']) expect(screen.getByRole('region', { name: label })).toBeVisible();
    expect(screen.getByLabelText('Official website (optional)')).not.toBeRequired();
    expect(screen.getByLabelText('Official website (optional)')).not.toBeVisible();
    expect(screen.getByRole('checkbox', { name: /I’m authorised/ })).toBeRequired();
    expect(screen.getByRole('checkbox', { name: /I’m authorised/ })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start verification' })).toHaveFocus();
    expect(submitInstitutionApplication).not.toHaveBeenCalled();
  });

  it('reveals a closed optional website field when native validation finds an invalid value', async () => {
    show(); await userEvent.click(await screen.findByRole('button', { name: 'Start verification' }));
    const website = screen.getByLabelText('Official website (optional)');
    fireEvent.change(website, { target: { value: 'not a URL' } });
    expect(website.closest('details')).not.toHaveAttribute('open');
    fireEvent.invalid(website);
    expect(website.closest('details')).toHaveAttribute('open');
    expect(website).toBeVisible();
    expect(submitInstitutionApplication).not.toHaveBeenCalled();
  });

  it('requires the declaration even for a direct submit and retains details after an owning refusal', async () => {
    vi.mocked(submitInstitutionApplication).mockRejectedValue(new ApiError('Please check the registration reference.', 400));
    show(); await enterDetails();
    const form = screen.getByRole('button', { name: 'Submit for review' }).closest('form')!;
    fireEvent.submit(form);
    expect(screen.getByRole('alert')).toHaveTextContent('Confirm that you are authorised');
    expect(submitInstitutionApplication).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('checkbox', { name: /I’m authorised/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please check the registration reference.');
    expect(submitInstitutionApplication).toHaveBeenCalledWith(expect.objectContaining({ school_id: 'campus', timezone: 'Asia/Kolkata', institution_name: 'Lotus Learning', website: '', declaration_accepted: true }));
    expect(screen.getByRole('textbox', { name: /^Registration or affiliation reference/ })).toHaveValue('TR-2026');
    expect(screen.getByRole('checkbox', { name: /I’m authorised/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeEnabled();
  });

  it('locks in-flow navigation and cancellation until the submission and refreshed status settle', async () => {
    let accept: ((value: InstitutionApplication) => void) | undefined;
    vi.mocked(submitInstitutionApplication).mockImplementation(() => new Promise(resolve => { accept = resolve; }));
    show(); await enterDetails(); await userEvent.click(screen.getByRole('checkbox', { name: /I’m authorised/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    expect(screen.getByLabelText('Registered organisation name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Done' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('link', { name: 'Done' }));
    await userEvent.click(screen.getByRole('link', { name: 'ThatCampus home' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/more/verification');
    vi.mocked(getProgressiveWorkspace).mockResolvedValue({ ...snapshot, applications: [application] });
    await act(async () => { accept?.(application); await Promise.resolve(); });
    expect(await screen.findByRole('region', { name: 'Under review' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Under review' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Submit for review' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Done' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('link', { name: 'Continue campus setup' })).toBeVisible();
  });

  it('guards the actual workspace Back seam while its request is pending', async () => {
    vi.mocked(submitInstitutionApplication).mockImplementation(() => new Promise(() => undefined));
    show({ presentation: 'workspace' }); await enterDetails(); await userEvent.click(screen.getByRole('checkbox', { name: /I’m authorised/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Workspace Back' }));
    expect(back).not.toHaveBeenCalled();
  });

  it('retains the exact review note and resubmission identity without implying approval', async () => {
    const current = { ...application, status: 'needs_information' as const, review_note: 'Please provide the organisation reference,\nnot a personal identity number.' };
    vi.mocked(getProgressiveWorkspace).mockResolvedValue({ ...snapshot, applications: [current] });
    vi.mocked(submitInstitutionApplication).mockRejectedValue(new Error('Review service unavailable.'));
    show();
    expect(await screen.findByRole('region', { name: 'More information requested' })).toHaveTextContent('Lotus Learning');
    expect(screen.getByRole('heading', { name: 'Review team note' }).nextElementSibling).toHaveProperty('textContent', current.review_note);
    await userEvent.click(screen.getByRole('button', { name: 'Update requested details' }));
    expect(screen.getByLabelText('Registered organisation name')).toHaveValue('Lotus Learning');
    expect(screen.getByRole('heading', { name: 'Review team note' }).nextElementSibling).toHaveProperty('textContent', current.review_note);
    await userEvent.click(screen.getByRole('checkbox', { name: /I’m authorised/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Resubmit for review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Review service unavailable.');
    expect(submitInstitutionApplication).toHaveBeenCalledWith(expect.objectContaining({ application_id: 'review', declaration_accepted: true }));
  });

  it.each(['rejected', 'withdrawn'] as const)('keeps a %s review explicit and starts a new request without reusing its application id', async status => {
    vi.mocked(getProgressiveWorkspace).mockResolvedValue({ ...snapshot, applications: [{ ...application, status }] });
    vi.mocked(submitInstitutionApplication).mockRejectedValue(new Error('Try again.'));
    show(); await userEvent.click(await screen.findByRole('button', { name: 'Start a new review' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /I’m authorised/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    await screen.findByRole('alert');
    expect(submitInstitutionApplication).toHaveBeenCalledWith(expect.objectContaining({ application_id: undefined }));
  });

  it('shows the current verified workspace without offering another submission', async () => {
    vi.mocked(getProgressiveWorkspace).mockResolvedValue({ ...snapshot, workspace: { ...snapshot.workspace!, verification_status: 'approved' }, applications: [{ ...application, status: 'approved' }] });
    show(); expect(await screen.findByRole('heading', { level: 1, name: 'Your organisation is verified.' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Verified' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /verification|review/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue campus setup' })).toBeVisible();
  });

  it('hides cached campus details on a current access refusal and offers retry', async () => {
    vi.mocked(getProgressiveWorkspace).mockRejectedValue(new ApiError('Verification access changed.', 403));
    show({ cached: { ...snapshot, applications: [application] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Verification access changed.');
    expect(screen.queryByText('Lotus Learning')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start verification' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  it.each([
    { mode: 'simulation', namespaceId: 'scenario', runId: 'running', virtualClock: { now: '2026-10-21T09:00:00Z', timeZone: 'Asia/Kolkata' } },
    { mode: 'simulation', namespaceId: 'scenario', runId: 'stopped', runStatus: 'stopped', virtualClock: { now: '2026-10-21T09:00:00Z', timeZone: 'Asia/Kolkata' } },
    { mode: 'simulation', namespaceId: 'scenario', runId: 'unavailable', unavailable: true, unavailableReason: 'authorization_lost' },
  ] satisfies ExecutionEnvironment[])('keeps account verification read- and write-free in $runId Simulation', async environment => {
    show({ environment, cached: { ...snapshot, applications: [application] } });
    expect(screen.getByRole('heading', { name: 'Verification belongs to Live' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Simulation controls' })).toHaveAttribute('href', '/more/simulation');
    expect(screen.queryByText('Lotus Learning')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await waitFor(() => expect(getProgressiveWorkspace).not.toHaveBeenCalled());
    expect(submitInstitutionApplication).not.toHaveBeenCalled();
    expect(within(screen.getByRole('main')).queryByRole('textbox')).not.toBeInTheDocument();
  });
});
