import { isInternalHref } from './api-policy';
import { visitJoinReturnTarget } from '../auth/visit-join-policy';
/** Current web still emits these root query links alongside canonical paths. */
export function canonicalInstitutionHref(value: string): string {
  const url = new URL(value, 'https://thatcampus.invalid');
  if (url.pathname !== '/more/setup/institution' || url.searchParams.getAll('section').length !== 1) return value;
  const target = ({ campus: '/more/setup/institution/campus', setup: '/more/setup/institution/academics', access: '/more/setup/people/access', audit: '/more/setup/institution/history', promotion: '/more/setup/institution/promotion', rules: '/more/setup/institution/operating-rules' } as Record<string, string>)[url.searchParams.get('section') ?? ''];
  if (!target) return value;
  url.searchParams.delete('section');
  return `${target}${url.search}${url.hash}`;
}
export function canonicalNativeHref(value: string): string {
  if (!isInternalHref(value)) throw new Error('This link is outside ThatCampus.');
  value = canonicalInstitutionHref(value);
  if (['/', '/home', '/dashboard'].includes(value)) return '/today';
  if (/^\/account\/profile(?:[?#]|$)/.test(value)) return value.replace('/account/profile', '/more/account');
  if (value.startsWith('/account/security')) return value.replace('/account/security', '/more/account/security');
  if (value === '/account' || value.startsWith('/account?')) return value.replace('/account', '/more/account');
  if (value === '/visit-join' || visitJoinReturnTarget(value)) return value;
  if (/^\/(today|work|areas|more)(?:[/?#]|$)/.test(value)) return value;
  if (/^\/(?:onboarding\/start|join|company(?:\/institutions\/[0-9a-f-]{36})?|login|signup|forgot-password|reset-password|demo|workspace)(?:[?#]|$)/i.test(value)) return value;
  // Legacy source routes remain visible as an explicit unmigrated destination.
  return `/more/source?href=${encodeURIComponent(value)}`;
}
