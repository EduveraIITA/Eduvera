import { useSession } from '../auth/SessionProvider';
import { getApiOrigin } from './api';
import { useNativePendingAction, type NativePendingInput, type NativePendingAction } from './native-pending-action';
import { learningAuthoringObsolete, learningAuthoringRefreshPath } from './learning-authoring-policy';
import { useOperationContext } from './use-operation-context';

/** One shared learning journal serializes instructor, learner and group writes.
 * An accepted command refreshes only its retained read path after restart. */
export function useLearningCommand<T>({ ownerHref, refreshPath, onAccepted, resolveRefreshPath }: {
  ownerHref: string; refreshPath: string;
  onAccepted?: (value: T, assertCurrent: () => void, action: NativePendingAction) => Promise<void> | void;
  resolveRefreshPath?: (value: unknown, action: NativePendingAction) => string;
}) {
  const { user, schoolId, environment } = useSession();
  const captureOperation = useOperationContext(JSON.stringify([ownerHref, refreshPath]));
  const writer = useNativePendingAction<T>({
    scope: { actorId: user!.id, schoolId: schoolId!, mode: environment.mode, namespaceId: environment.namespace_id ?? null, origin: getApiOrigin() },
    domain: 'learning', ownerHref, refreshPath, accepted: onAccepted, resolveRefreshPath: resolveRefreshPath ?? learningAuthoringRefreshPath,
    obsolete: learningAuthoringObsolete, captureOperation,
  });
  return { ...writer, locked: writer.locked || !!environment.unavailable,
    run: (input: NativePendingInput) => writer.run({ ...input, serverKey: input.multipart ? undefined : input.serverKey === undefined ? 'command_id' : input.serverKey }),
  };
}
