import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FeedbackResults } from './FeedbackResults';
import { feedbackOverview } from './feedback-analytics';
import { getResults, type Summary } from './api';
vi.mock('./api', () => ({ getResults: vi.fn() }));
afterEach(cleanup);
const parameters: Summary['parameters'] = [
  { parameter: 'Punctuality', rated: 10, counts: { high: 8, okay: 1, low: 1, na: 2 }, signal: 'strength' },
  { parameter: 'Teaching clarity', rated: 10, counts: { high: 2, okay: 3, low: 5, na: 2 }, signal: 'review' },
  { parameter: 'Hidden parameter', rated: 4, counts: null, signal: 'insufficient' },
];
const summary: Summary = { campaign: { id: 'round', title: 'Check-in', teacher_name: 'Teacher', class_name: '7A', audience: 'students', parameters: parameters.map(p => p.parameter), closes_at: '2026-10-08T12:00:00Z', is_closed: true, response_count: 12 }, response_count: 12, available: true, parameters,
  activity: [{ date: '2026-10-07', count: 5 }, { date: '2026-10-08', count: 7 }], history: [] };
function show(data: Summary) {
  vi.mocked(getResults).mockResolvedValue(data);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FeedbackResults school="school" id="round" /></QueryClientProvider>);
}
describe('feedback results analytics', () => {
  it('excludes hidden and Not sure answers from the rated denominator', () => {
    expect(feedbackOverview(parameters)).toMatchObject({ rated: 20, visible: 2, counts: { high: 10, okay: 4, low: 6, na: 4 } });
    expect(feedbackOverview([{ ...parameters[2]!, rated: 100 }])).toMatchObject({ rated: 0, visible: 0, strengths: [], priorities: [] });
  });
  it('shows accurate chart totals and expandable counts, including sorting', async () => {
    const user = userEvent.setup(); show(summary);
    expect(await screen.findByRole('img', { name: '50% of 20 rated answers are High' })).toBeVisible();
    expect(screen.getByText(/20 rated answers across 2 parameters/)).toHaveTextContent('4 Not sure answers excluded');
    await user.selectOptions(screen.getByLabelText('Sort'), 'support');
    const sections = document.querySelectorAll('.feedback-parameter');
    expect(sections[0]!).toHaveTextContent('Teaching clarity');
    const control = sections[0]!.querySelector('summary')!; await user.click(control);
    expect(sections[0]!).toHaveAttribute('open');
    expect(within(sections[0]! as HTMLElement).getByText('5', { selector: 'dd' })).toBeVisible();
    expect(screen.getByText(/Try a worked example/)).toBeVisible();
    expect(screen.getByText(/A trend needs two closed rounds/)).toBeVisible();
  });
  it('never renders rating charts or insights for open or insufficient results', async () => {
    show({ ...summary, available: false, campaign: { ...summary.campaign, is_closed: false }, response_count: 1 });
    expect(await screen.findByText('Results unlock when this request closes.')).toBeVisible();
    expect(screen.queryByText('Rating mix')).not.toBeInTheDocument();
    expect(screen.queryByText('By parameter')).not.toBeInTheDocument();
    expect(screen.queryByText('Teaching clarity')).not.toBeInTheDocument();
    expect(screen.getByText(/4 more responses needed/)).toBeVisible();
  });
  it('shows clearly labelled one-response demo charts while the request stays open', async () => {
    show({ ...summary, demo_preview: true, minimum_responses: 1, response_count: 1, campaign: { ...summary.campaign, is_closed: false }, parameters: [{ parameter: 'Punctuality', rated: 1, counts: { low: 0, okay: 0, high: 1, na: 0 }, signal: 'strength' }], activity: [{ date: '2026-10-08', count: 1 }] });
    expect(await screen.findByText(/Demo preview · results appear after 1 response/)).toBeVisible();
    expect(screen.getByRole('img', { name: '100% of 1 rated answer is High' })).toBeVisible();
    expect(screen.getByText(/at least 1 rating on every parameter/)).toBeVisible();
    expect(screen.queryByText('Results unlock when this request closes.')).not.toBeInTheDocument();
  });
  it('handles all-suppressed parameters without inventing a score', async () => {
    show({ ...summary, parameters: [parameters[2]!] });
    expect(await screen.findByText(/Charts will appear when a parameter/)).toBeVisible();
    expect(screen.getByText('No parameter has enough ratings for an insight yet.')).toBeVisible();
    expect(screen.queryByRole('img', { name: /rated answers are High/ })).not.toBeInTheDocument();
  });
  it('labels trend changes as percentage points and exposes raw sample counts', async () => {
    const user = userEvent.setup(); show({ ...summary, history: [
      { id: 'old', closed_at: '2026-09-08T12:00:00Z', response_count: 8, rated_count: 16, high_percent: 40 },
      { id: 'round', closed_at: '2026-10-08T12:00:00Z', response_count: 12, rated_count: 20, high_percent: 50 },
    ] });
    expect(await screen.findByText('+10 pp')).toBeVisible();
    await user.click(screen.getByText('Compare round details'));
    const table = screen.getByRole('table', { name: /Comparable feedback rounds/ });
    expect(within(table).getByText('8', { selector: 'td' })).toBeVisible();
    expect(within(table).getByText('12', { selector: 'td' })).toBeVisible();
    await user.click(screen.getByText('View response counts'));
    expect(screen.getByRole('table', { name: /Response activity/ })).toHaveTextContent('2026-10-08');
  });
  it('shows a useful zero-response state and retries a failed request', async () => {
    const user = userEvent.setup(); vi.mocked(getResults).mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue({ ...summary, available: false, response_count: 0, activity: [] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FeedbackResults school="school" id="round" /></QueryClientProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    await user.click(screen.getByRole('button', { name: 'Retry results' }));
    expect(await screen.findByText(/No responses yet/)).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
