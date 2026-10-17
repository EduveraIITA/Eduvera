import {
  clearPendingCommand,
  clearPendingCommandsForTests,
  isDefinitiveCommandFailure,
  pendingCommand,
} from "../../lib/pendingCommand";

export interface StaffCoverageCommandScope {
  schoolId: string;
  actorId: string;
  targetId: string;
}

export interface PendingStaffCoverageCommand {
  commandId: string;
  materialHash: string;
}

const PREFIX = "thatcampus:staff-coverage-command:v1";

function commandScope(scope: StaffCoverageCommandScope) {
  return {
    storageNamespace: PREFIX,
    institutionId: scope.schoolId,
    actorId: scope.actorId,
    operation: "respond",
    targetId: scope.targetId,
  };
}

export function pendingStaffCoverageCommand(
  scope: StaffCoverageCommandScope,
  material: unknown,
): Promise<PendingStaffCoverageCommand> {
  return pendingCommand(commandScope(scope), material);
}

export function clearPendingStaffCoverageCommand(
  scope: StaffCoverageCommandScope,
  command: PendingStaffCoverageCommand,
) {
  clearPendingCommand(commandScope(scope), command);
}

export const isDefinitiveStaffCoverageFailure = isDefinitiveCommandFailure;

export function clearPendingStaffCoverageCommandsForTests() {
  clearPendingCommandsForTests(PREFIX);
}
