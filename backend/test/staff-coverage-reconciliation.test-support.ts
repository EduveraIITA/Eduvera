import type { Transaction } from "kysely";
import type {
  ApprovedLeaveCoverageInput,
  CoverageReconciliationInput,
  CoverageReconciliationReceipt,
  CoverageProjectionPreparationReceipt,
  StaffCoverageReconciliationPort,
} from "../src/staff-operations/staff-coverage-reconciliation.service.js";
import type { Database } from "../src/database/types.js";

export interface StaffCoverageReconciliationTestDouble
  extends StaffCoverageReconciliationPort {
  readonly approvedLeaveInputs: ApprovedLeaveCoverageInput[];
  readonly preparationInputs: CoverageReconciliationInput[];
  readonly reconciliationInputs: CoverageReconciliationInput[];
}

const emptyReceipt = (): CoverageReconciliationReceipt => ({
  superseded_substitution_ids: [],
  cancelled_task_ids: [],
  reopened_task_ids: [],
  model_event_ids: [],
});

/**
 * Typed no-op for tests whose subject depends on the coverage port but does not
 * exercise the real reconciliation adapter. Calls are retained so workflow tests
 * can still prove that their authoritative write requested reconciliation.
 */
export function createStaffCoverageReconciliationTestDouble(
  options: {
    approvedTaskIds?: string[];
    receipt?: CoverageReconciliationReceipt;
  } = {},
): StaffCoverageReconciliationTestDouble {
  const approvedLeaveInputs: ApprovedLeaveCoverageInput[] = [];
  const preparationInputs: CoverageReconciliationInput[] = [];
  const reconciliationInputs: CoverageReconciliationInput[] = [];

  return {
    approvedLeaveInputs,
    preparationInputs,
    reconciliationInputs,
    createTasksForApprovedLeave(
      _transaction: Transaction<Database>,
      input: ApprovedLeaveCoverageInput,
    ) {
      approvedLeaveInputs.push(input);
      return Promise.resolve([...(options.approvedTaskIds ?? [])]);
    },
    prepareEffectiveCoverageProjection(
      _transaction: Transaction<Database>,
      input: CoverageReconciliationInput,
    ): Promise<CoverageProjectionPreparationReceipt> {
      preparationInputs.push(input);
      return Promise.resolve({ model_event_ids: [] });
    },
    reconcileEffectiveCoverage(
      _transaction: Transaction<Database>,
      input: CoverageReconciliationInput,
    ) {
      reconciliationInputs.push(input);
      return Promise.resolve(
        options.receipt
          ? {
              ...options.receipt,
              superseded_substitution_ids: [...options.receipt.superseded_substitution_ids],
              cancelled_task_ids: [...options.receipt.cancelled_task_ids],
              reopened_task_ids: [...options.receipt.reopened_task_ids],
              model_event_ids: [...options.receipt.model_event_ids],
            }
          : emptyReceipt(),
      );
    },
  };
}
