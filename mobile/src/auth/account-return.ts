import { isInternalHref } from '../lib/api-policy';
import { canonicalNativeHref } from '../lib/navigation';
import { visitJoinReturnTarget } from './visit-join-policy';

/** Revalidate links received in account URLs before giving them to navigation. */
export function safeAccountReturnTarget(value: unknown): string | null {
  const visit = visitJoinReturnTarget(value); if (visit) return visit;
  if (typeof value !== 'string' || value.length > 4096 || !isInternalHref(value)) return null;
  try {
    const parsed = new URL(value, 'https://thatcampus.invalid');
    if (parsed.origin !== 'https://thatcampus.invalid' || !(/^\/(?:today|areas|more|company|work)(?:\/|$)/.test(parsed.pathname)
      || ['/gate', '/workspace', '/onboarding/start', '/account/profile', '/account/security'].includes(parsed.pathname))) return null;
    return canonicalNativeHref(`${parsed.pathname}${parsed.search}${parsed.hash}`);
  } catch { return null; }
}

export function accountReturnTitle(href: string): string {
  const path = href.split(/[?#]/)[0];
  if (path === '/visit-join') return 'Visit';
  if (path === '/more/account' || path === '/account/profile') return 'Profile';
  const section = ({ '/more/account/details': 'Personal details', '/more/account/appearance': 'Appearance', '/more/account/assistant': 'Assistant preferences', '/more/account/campuses': 'Your campuses' } as Record<string, string>)[path ?? ''];
  if (section) return section;
  if (path?.endsWith('/account/security')) return 'Account security';
  if (path === '/onboarding/start') return 'Campus setup';
  if (path === '/today') return 'Today';
  if (path === '/work' || path?.startsWith('/work/')) return 'Work';
  if (path === '/company' || path?.startsWith('/company/')) return 'Company workspace';
  if (path === '/areas') return 'Areas';
  if (path === '/more') return 'More';
  const owner = path?.split('/').filter(Boolean).at(1);
  return ({ fees: 'Fees', updates: 'Updates', events: 'Events', people: 'People', timetable: 'Timetable', attendance: 'Attendance', simulation: 'Simulation', setup: 'Campus setup', messages: 'Messages', governance: 'Governance' } as Record<string,string>)[owner ?? ''] ?? 'Your workspace';
}
