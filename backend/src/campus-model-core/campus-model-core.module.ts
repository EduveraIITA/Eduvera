import { Module } from "@nestjs/common";
import { CAMPUS_MODEL_CORE_PORT } from "./campus-model-core.port.js";
import { COORDINATION_RUNTIME_PORT } from "./coordination-runtime.port.js";
import { OBSERVATION_INGRESS_PORT } from "./observation-ingress.port.js";
import { OBSERVATION_SOURCE_REGISTRY_PORT } from "./observation-source-registry.port.js";
import { CampusModelCoreService } from "./campus-model-core.service.js";
import { HUMAN_AGENT_IDENTITY_PORT } from "./human-agent-identity.port.js";
import { TEMPORAL_CONTEXT_PORT } from "./temporal-context.port.js";
import { OPERATIONAL_REALM_PORT } from "./operational-realm.port.js";
import { MODEL_CONTRACT_REGISTRY_PORT } from "./model-contract-registry.port.js";
import { AUTHORITY_EVALUATION_PORT } from "./authority-evaluation.port.js";
import { PROJECTION_CHECKPOINT_PORT } from "./projection-checkpoint.port.js";
import { EXECUTION_SNAPSHOT_PORT } from "./execution-snapshot.port.js";
import { ExecutionProvisioningService } from "./execution-provisioning.service.js";
import { EXECUTION_PROVISIONING_PORT } from "./execution-provisioning.port.js";
import { PROJECTION_RECOVERY_PORT } from "./projection-recovery.port.js";
import { ENVIRONMENT_RETENTION_PORT } from "./environment-retention.port.js";
import { DOMAIN_COMMAND_GATEWAY_PORT } from "./domain-command-gateway.port.js";

@Module({
  providers: [
    CampusModelCoreService,
    ExecutionProvisioningService,
    { provide: CAMPUS_MODEL_CORE_PORT, useExisting: CampusModelCoreService },
    { provide: OBSERVATION_INGRESS_PORT, useExisting: CampusModelCoreService },
    { provide: OBSERVATION_SOURCE_REGISTRY_PORT, useExisting: CampusModelCoreService },
    { provide: TEMPORAL_CONTEXT_PORT, useExisting: CampusModelCoreService },
    { provide: COORDINATION_RUNTIME_PORT, useExisting: CampusModelCoreService },
    { provide: HUMAN_AGENT_IDENTITY_PORT, useExisting: CampusModelCoreService },
    { provide: OPERATIONAL_REALM_PORT, useExisting: CampusModelCoreService },
    { provide: MODEL_CONTRACT_REGISTRY_PORT, useExisting: CampusModelCoreService },
    { provide: AUTHORITY_EVALUATION_PORT, useExisting: CampusModelCoreService },
    { provide: PROJECTION_CHECKPOINT_PORT, useExisting: CampusModelCoreService },
    { provide: EXECUTION_SNAPSHOT_PORT, useExisting: CampusModelCoreService },
    { provide: EXECUTION_PROVISIONING_PORT, useExisting: ExecutionProvisioningService },
    { provide: PROJECTION_RECOVERY_PORT, useExisting: ExecutionProvisioningService },
    { provide: ENVIRONMENT_RETENTION_PORT, useExisting: ExecutionProvisioningService },
    { provide: DOMAIN_COMMAND_GATEWAY_PORT, useExisting: CampusModelCoreService },
  ],
  exports: [
    CAMPUS_MODEL_CORE_PORT,
    OBSERVATION_INGRESS_PORT,
    OBSERVATION_SOURCE_REGISTRY_PORT,
    TEMPORAL_CONTEXT_PORT,
    COORDINATION_RUNTIME_PORT,
    HUMAN_AGENT_IDENTITY_PORT,
    OPERATIONAL_REALM_PORT,
    MODEL_CONTRACT_REGISTRY_PORT,
    AUTHORITY_EVALUATION_PORT,
    PROJECTION_CHECKPOINT_PORT,
    EXECUTION_SNAPSHOT_PORT,
    EXECUTION_PROVISIONING_PORT,
    PROJECTION_RECOVERY_PORT,
    ENVIRONMENT_RETENTION_PORT,
    DOMAIN_COMMAND_GATEWAY_PORT,
  ],
})
export class CampusModelCoreModule {}
