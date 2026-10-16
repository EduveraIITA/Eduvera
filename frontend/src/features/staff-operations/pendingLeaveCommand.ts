import {
  clearPendingCommand,
  clearPendingCommandsForTests,
  isDefinitiveCommandFailure,
  pendingCommand,
  pendingCommandMaterialHash,
} from "../../lib/pendingCommand";

export type StaffLeaveCommandOperation = "submit" | "decide" | "withdraw";

export interface StaffLeaveCommandScope {
  schoolId: string;
  actorId: string;
  operation: StaffLeaveCommandOperation;
  targetId: string;
}

export interface PendingStaffLeaveCommand {
  commandId: string;
  materialHash: string;
}

const PREFIX = "thatcampus:staff-leave-command:v1";

function commandScope(scope: StaffLeaveCommandScope) {
  return {
    storageNamespace: PREFIX,
    institutionId: scope.schoolId,
    actorId: scope.actorId,
    operation: scope.operation,
    targetId: scope.targetId,
  };
}

export const staffLeaveMaterialHash = pendingCommandMaterialHash;

export async function pendingStaffLeaveCommand(
  scope: StaffLeaveCommandScope,
  material: unknown,
): Promise<PendingStaffLeaveCommand> {
  return pendingCommand(commandScope(scope), material);
}

export function clearPendingStaffLeaveCommand(
  scope: StaffLeaveCommandScope,
  command: PendingStaffLeaveCommand,
) {
  clearPendingCommand(commandScope(scope), command);
}

export const isDefinitiveStaffLeaveFailure = isDefinitiveCommandFailure;

export function clearPendingStaffLeaveCommandsForTests() {
  clearPendingCommandsForTests(PREFIX);
}
