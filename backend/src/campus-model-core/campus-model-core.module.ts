import { Module } from "@nestjs/common";
import { CAMPUS_MODEL_CORE_PORT } from "./campus-model-core.port.js";
import { OBSERVATION_INGRESS_PORT } from "./observation-ingress.port.js";
import { CampusModelCoreService } from "./campus-model-core.service.js";

@Module({
  providers: [
    CampusModelCoreService,
    { provide: CAMPUS_MODEL_CORE_PORT, useExisting: CampusModelCoreService },
    { provide: OBSERVATION_INGRESS_PORT, useExisting: CampusModelCoreService },
  ],
  exports: [CAMPUS_MODEL_CORE_PORT, OBSERVATION_INGRESS_PORT],
})
export class CampusModelCoreModule {}
