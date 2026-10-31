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
export function ownedParticipationTestServices(database: DatabaseService) {
  const core = new CampusModelCoreService(database);
  const authorities = new ParticipationContextAuthorityRegistry();
  const kernel = new ActivityAttendanceService(database, core, core, core, core, core, authorities);
  const footprints=new OwnedPlanFootprintBridge(core);
  const planning=new ActivityPlanningService(database,new SchoolEventService(database,core),core,core,core,new ResponsibilityProjectionService(core));
  return { core, authorities, kernel, bridge: new OwnedParticipationBridge(kernel), footprints, planning };
}
