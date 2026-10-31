import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { ProgressiveWorkspaceProvisioner } from "./progressive-workspace.provisioner.js";

@Module({
  imports: [CampusModelCoreModule],
  providers: [ProgressiveWorkspaceProvisioner],
  exports: [ProgressiveWorkspaceProvisioner],
})
export class ProgressiveWorkspaceModule {}
