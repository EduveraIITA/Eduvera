import { Module } from "@nestjs/common";
import { CAMPUS_MODEL_CORE_PORT } from "./campus-model-core.port.js";
import { CampusModelCoreService } from "./campus-model-core.service.js";

@Module({
  providers: [
    CampusModelCoreService,
    { provide: CAMPUS_MODEL_CORE_PORT, useExisting: CampusModelCoreService },
  ],
  exports: [CAMPUS_MODEL_CORE_PORT],
})
export class CampusModelCoreModule {}
