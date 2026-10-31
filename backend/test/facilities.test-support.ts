import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { CoordinationConfigurationService } from '../src/campus-model-core/coordination-configuration.service.js';
import { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { FacilitiesService } from '../src/facilities/facilities.service.js';
import { FacilitiesAccess } from '../src/facilities/facilities.access.js';
import { FacilitiesModel } from '../src/facilities/facilities.model.js';
import { FacilitiesArtifactStore } from '../src/facilities/facilities-artifacts.js';
import { createResourceLoanFixture } from './resource-loans.test-support.js';
export function facilitiesServices(db:DatabaseService){const core=new CampusModelCoreService(db,new ExecutionDataPlaneScope()),access=new FacilitiesAccess(core),model=new FacilitiesModel(core,core,core,new CoordinationConfigurationService(core),core),artifacts=new FacilitiesArtifactStore(),facilities=new FacilitiesService(db,access,model,artifacts);return {core,access,model,artifacts,facilities};}
/** Ordinary founder and normally invited neutral member; no academic scaffolding. */
export async function createFacilitiesFixture(db:DatabaseService){const base=await createResourceLoanFixture(db);return {...base,...facilitiesServices(db)};}
