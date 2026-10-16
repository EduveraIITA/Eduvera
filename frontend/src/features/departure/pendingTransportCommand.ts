import {
  clearPendingCommand,
  clearPendingCommandsForTests,
  isDefinitiveCommandFailure,
  pendingCommand,
} from "../../lib/pendingCommand";

export type TransportCommandOperation = "request" | "respond" | "decide";

export interface TransportCommandScope {
  schoolId: string;
  actorId: string;
  operation: TransportCommandOperation;
  targetId: string;
}

const STORAGE_NAMESPACE = "thatcampus:transport-duty-command:v1";

function commandScope(scope: TransportCommandScope) {
  return {
    storageNamespace: STORAGE_NAMESPACE,
    institutionId: scope.schoolId,
    actorId: scope.actorId,
    operation: scope.operation,
    targetId: scope.targetId,
  };
}

/**
 * Reuses one command identity after a reload or an ambiguous response, but only
 * when actor, institution, operation, target and normalized command material all
 * still match. A confirmed outcome or definitive 4xx releases the identity.
 */
export async function executePendingTransportCommand<TResult>(
  scope: TransportCommandScope,
  material: unknown,
  execute: (commandId: string) => Promise<TResult>,
) {
  const genericScope = commandScope(scope);
  const command = await pendingCommand(genericScope, material);
  try {
    const result = await execute(command.commandId);
    clearPendingCommand(genericScope, command);
    return result;
  } catch (error) {
    if (isDefinitiveCommandFailure(error)) clearPendingCommand(genericScope, command);
    throw error;
  }
}

export function clearPendingTransportCommandsForTests() {
  clearPendingCommandsForTests(STORAGE_NAMESPACE);
}
