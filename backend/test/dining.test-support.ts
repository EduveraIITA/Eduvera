import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { CoordinationConfigurationService } from "../src/campus-model-core/coordination-configuration.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { DiningService } from "../src/dining/dining.service.js";
import { DiningAccess } from "../src/dining/dining.access.js";
import { DiningModel } from "../src/dining/dining.model.js";
import { DiningWeeklyService } from "../src/dining/dining-weekly.service.js";
import {
  createResourceLoanFixture,
  resourceLoanServices,
} from "./resource-loans.test-support.js";
export function diningServices(db: DatabaseService) {
  const services = resourceLoanServices(db),
    core = new CampusModelCoreService(db, new ExecutionDataPlaneScope()),
    diningAccess = new DiningAccess(core),
    diningModel = new DiningModel(
      core,
      core,
      core,
      new CoordinationConfigurationService(core),
      core,
    ),
    diningWeekly = new DiningWeeklyService(db, core),
    dining = new DiningService(db, diningAccess, diningModel, diningWeekly);
  return { ...services, core, diningAccess, diningModel, dining };
}
export async function createDiningFixture(db: DatabaseService) {
  return { ...(await createResourceLoanFixture(db)), ...diningServices(db) };
}
