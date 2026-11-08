import type { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import { ActivityAttendanceService } from '../src/attendance/activity-attendance.service.js';
import { OwnedParticipationBridge } from '../src/attendance/owned-participation-bridge.service.js';
import { ParticipationContextAuthorityRegistry } from '../src/attendance/participation-context-authority.js';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { OwnedPlanFootprintBridge } from '../src/schedule-planning/owned-plan-footprint.bridge.js';
import { ActivityPlanningService } from '../src/schedule-planning/activity-planning.service.js';
import { SchoolEventService } from '../src/school/school-event.service.js';
import { ResponsibilityProjectionService } from '../src/campus-model-core/responsibility-projection.service.js';

/** Real shared kernel, not a bypass of the migrated accepted writer. */
export function ownedParticipationTestServices(database: DatabaseService, scope?:ExecutionDataPlaneScope) {
  const core = new CampusModelCoreService(database,scope);
  const authorities = new ParticipationContextAuthorityRegistry();
  const kernel = new ActivityAttendanceService(database, core, core, core, core, core, authorities);
  const footprints=new OwnedPlanFootprintBridge(core,core);
  const planning=new ActivityPlanningService(database,new SchoolEventService(database,core),core,core,core,new ResponsibilityProjectionService(core));
  return { core, authorities, kernel, bridge: new OwnedParticipationBridge(kernel,core), footprints, planning };
}
