import { visitPublicInput, type VisitPublicAction } from './visit-join-policy';
import type { SessionOperation } from './session-lifecycle';
import { browserAuthMutation, type BrowserAuthApi } from './web-auth-mutation';

/** A non-session-issuing ceremony still belongs to the existing Auth transport.
 * Preserve any bound native bearer so selected Simulation cannot become anonymous. */
export async function requestVisitOnboarding(api: BrowserAuthApi, platform: 'native' | 'web', action: VisitPublicAction, body: unknown, operation: SessionOperation, assertPresentation: () => void, onDispatch?: () => void) {
  const input = visitPublicInput(action,body), guard: SessionOperation = { isCurrent: operation.isCurrent, assertCurrent() { operation.assertCurrent(); assertPresentation(); } };
  guard.assertCurrent();
  const path = `/api/v1/auth/${platform === 'native' ? 'native/' : ''}visit-onboarding/${action}/`;
  const result = platform === 'web' ? await browserAuthMutation(api,path,input,guard,() => { guard.assertCurrent(); onDispatch?.(); }) : await (() => { guard.assertCurrent(); onDispatch?.(); return api.apiFetch(path,{ method: 'POST',body: JSON.stringify(input) }); })();
  guard.assertCurrent(); return result;
}
