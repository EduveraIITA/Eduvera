import { describe, expect, it } from 'vitest';
import { assignedWorkRequestAllowed } from '../src/auth/assigned-work-access.js';

const school = '10000000-0000-4000-8000-000000000001';
const visit = '20000000-0000-4000-8000-000000000001';
const command = '30000000-0000-4000-8000-000000000001';
const base = `/api/v1/gate/schools/${school}/visit-arrangements`;

describe('Private visitor bounded request adapter', () => {
  it('allows only the exact guest read, discovery, own receipt and question paths', () => {
    for (const path of [`${base}/shared`, `${base}/shared/discovery`, `${base}/${visit}/shared`,
      `${base}/${visit}/shared/commands/${command}`]) {
      expect(assignedWorkRequestAllowed('GET', path, school), path).toBe(true);
      expect(assignedWorkRequestAllowed('HEAD', `${path}/`, school), path).toBe(true);
    }
    expect(assignedWorkRequestAllowed('POST', `${base}/${visit}/shared/questions`, school)).toBe(true);
  });

  it('does not grant coordinator views, host decisions, observation, invitation management or arbitrary verbs', () => {
    for (const [method, path] of [
      ['GET', base], ['GET', `${base}/options`], ['GET', `${base}/${visit}`], ['GET', `${base}/${visit}/sharing`],
      ['POST', base], ['POST', `${base}/${visit}/update`], ['POST', `${base}/${visit}/cancel`],
      ['POST', `${base}/${visit}/movements`], ['POST', `${base}/${visit}/shares`],
      ['POST', `${base}/${visit}/shares/${command}/revoke`], ['POST', `${base}/${visit}/shares/${command}/takeover`],
      ['POST', `${base}/${visit}/shared/questions/${command}/replies`], ['PUT', `${base}/${visit}/shared/questions`],
      ['POST', `${base}/shared`], ['DELETE', `${base}/${visit}/shared`],
    ]) expect(assignedWorkRequestAllowed(method!, path!, school), `${method} ${path}`).toBe(false);
  });

  it('refuses cross-campus and lookalike source paths', () => {
    for (const path of [base.replace(school, command) + `/${visit}/shared`, `${base}/${visit}/shared/other`,
      `${base}/${visit}/shared/questions/${command}`, `${base}/${visit}/shared%2Fquestions`,
      `/api/v1/schools/${school}/visit-arrangements/${visit}/shared`])
      expect(assignedWorkRequestAllowed('GET', path, school), path).toBe(false);
  });
});
