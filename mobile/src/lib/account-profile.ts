import type { AuthUser } from '../auth/session-types';
import { safeAccountReturnTarget } from '../auth/account-return';

export type AccountSection = 'profile' | 'details' | 'appearance' | 'assistant' | 'campuses';
const sections: Record<string, AccountSection> = { '/more/account/details': 'details', '/more/account/appearance': 'appearance', '/more/account/assistant': 'assistant', '/more/account/campuses': 'campuses' };
export function accountSection(href: string): AccountSection {
  const path = href.split(/[?#]/)[0] ?? '';
  return Object.hasOwn(sections, path) ? sections[path]! : 'profile';
}
/** Keep a bounded original destination; never nest one account URL in another. */
export function accountProfileHref(section: AccountSection, href: string): string {
  const url = new URL(href, 'https://thatcampus.invalid');
  const from = safeAccountReturnTarget(url.searchParams.get('from'));
  const path = '/more/account' + (section === 'profile' ? '' : '/' + section);
  return path + (from && !from.split('?')[0]?.startsWith('/more/account') ? '?' + new URLSearchParams({ from }) : '');
}
export const accountName = (user: Pick<AuthUser, 'first_name' | 'last_name'>) => `${user.first_name} ${user.last_name}`.trim();
export function accountNameChange(name: string, user: Pick<AuthUser, 'first_name' | 'last_name'>) {
  const value = name.trim();
  if (!value || value.length > 150 || /\p{Cc}/u.test(value)) throw new Error('Enter a name of up to 150 characters, without control characters.');
  return { first_name: value, last_name: '', expected_first_name: user.first_name, expected_last_name: user.last_name };
}
