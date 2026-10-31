import { eventAdminReceiptMatches, eventRulesValid, type EventAdminIntent } from './EventAdminPolicy';
export interface EventAdminExecutionPorts {
  assertCurrent(): void; assertReview?(): void;
  persist(intent: EventAdminIntent): Promise<void>; clear(): Promise<void>;
  send(intent: EventAdminIntent): Promise<unknown>;
  inspectRules(intent: EventAdminIntent): Promise<unknown>;
  refresh(intent: EventAdminIntent): Promise<unknown>;
}
export function assertEventAdminOwner(intent: EventAdminIntent, href: string) {
  if (intent.ownerHref !== href) throw new Error('Return to the original event review before continuing this exact action.');
}
/** A confirmation's source lease is checked before persistence and again before
 * send. After acceptance, only focus/transport stay required: the owner's own
 * refresh is allowed to advance the reviewed source revision. */
export async function executeEventAdminIntent(intent: EventAdminIntent, recovering: boolean, ports: EventAdminExecutionPorts) {
  ports.assertCurrent(); ports.assertReview?.();
  if (intent.accepted === undefined) {
    if (recovering && intent.kind === 'rules') {
      const current = await ports.inspectRules(intent); ports.assertCurrent();
      if (!eventRulesValid(current)) throw new Error('Current event rules could not be verified. The earlier action remains retained.');
      return 'rules_unconfirmed' as const;
    }
    await ports.persist(intent); ports.assertCurrent(); ports.assertReview?.();
    const result = await ports.send(intent); ports.assertCurrent();
    if (!eventAdminReceiptMatches(intent, result)) throw new Error('The response did not prove this exact action. Its original details remain retained.');
    intent.accepted = result; await ports.persist(intent); ports.assertCurrent();
  }
  await ports.refresh(intent); ports.assertCurrent();
  await ports.clear(); ports.assertCurrent();
  return 'accepted' as const;
}
