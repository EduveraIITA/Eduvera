import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { CoordinationConfigurationService } from "../src/campus-model-core/coordination-configuration.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { AccommodationService } from "../src/facilities/accommodation/accommodation.service.js";
import { AccommodationAccess } from "../src/facilities/accommodation/accommodation.access.js";
import { AccommodationModel } from "../src/facilities/accommodation/accommodation.model.js";
import {
  createResourceLoanFixture,
  resourceLoanServices,
} from "./resource-loans.test-support.js";
export function accommodationServices(db: DatabaseService) {
  const services = resourceLoanServices(db),
    core = new CampusModelCoreService(db, new ExecutionDataPlaneScope()),
    accommodationAccess = new AccommodationAccess(core),
    accommodationModel = new AccommodationModel(
      core,
      core,
      core,
      new CoordinationConfigurationService(core),
      core,
    ),
    accommodation = new AccommodationService(
      db,
      accommodationAccess,
      accommodationModel,
      services.resources,
    );
  return {
    ...services,
    core,
    accommodation,
    accommodationAccess,
    accommodationModel,
  };
}
export async function createAccommodationFixture(db: DatabaseService) {
  return {
    ...(await createResourceLoanFixture(db)),
    ...accommodationServices(db),
  };
}
