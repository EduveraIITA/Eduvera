import { BadGatewayException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { config } from "../config.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { assertLiveExternalEffect } from "../common/simulation-effects.js";
import {
  captureSimulationProviderEffect,
  selectedSimulationResources,
  simulationLogicalDigest,
} from "../common/simulation-resources.js";
import type { VisionClass, VisionHealth, VisionLlmStatus, VisionSession, VisionStudent } from "./contracts.js";

@Injectable()
export class PhotoAttendanceVisionClient {
  private get settings() { return config(); }

  /** Simulation provides a manual-review substitute without requiring Live provider configuration. */
  get simulationActive(): boolean { return selectedSimulationResources() !== null; }
  get available(): boolean { return this.simulationActive || this.settings.PHOTO_ATTENDANCE_ENABLED; }

  private artifactKey(logicalKey: string): string {
    return simulationLogicalDigest(`vision:${logicalKey}`);
  }

  private async readArtifact(logicalKey: string): Promise<unknown> {
    const selected = selectedSimulationResources();
    if (!selected) throw new Error("Simulation vision state was requested outside Simulation.");
    const value = await selected.artifacts.read(this.artifactKey(logicalKey));
    if (!value) return null;
    try { return JSON.parse(value.toString("utf8")) as unknown; }
    catch { throw new ServiceUnavailableException("The Simulation photo-review state is unavailable."); }
  }

  private async writeArtifact(logicalKey: string, value: unknown): Promise<void> {
    const selected = selectedSimulationResources();
    if (!selected) throw new Error("Simulation vision state was requested outside Simulation.");
    await selected.artifacts.write(this.artifactKey(logicalKey), Buffer.from(JSON.stringify(value)), false);
  }

  private async capture(
    operation: string,
    logicalKey: string,
    payload: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    await captureSimulationProviderEffect({
      kind: operation === "analyze" || operation === "enroll" ? "external_compute_call" : "connector_call",
      provider: "vision",
      operation,
      logicalKey,
      idempotencyKey: `vision:${operation}:${simulationLogicalDigest(logicalKey)}`,
      payload,
    });
  }

  private validClass(value: unknown): value is VisionClass {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<VisionClass>;
    return typeof item.id === "string" && item.id.startsWith("sim-class-")
      && typeof item.name === "string" && typeof item.created === "number";
  }

  private validStudent(value: unknown): value is VisionStudent {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<VisionStudent>;
    return typeof item.id === "string" && item.id.startsWith("sim-student-")
      && typeof item.class_id === "string" && typeof item.roll_number === "string"
      && typeof item.name === "string" && (item.sample_count === undefined || Number.isInteger(item.sample_count));
  }

  private async simulationClasses(): Promise<VisionClass[]> {
    const value = await this.readArtifact("classes");
    if (value === null) return [];
    if (!Array.isArray(value) || value.some((item) => !this.validClass(item))) {
      throw new ServiceUnavailableException("The Simulation photo-review class state is unavailable.");
    }
    return value;
  }

  private async simulationStudents(classId: string): Promise<VisionStudent[]> {
    const value = await this.readArtifact(`class:${classId}:students`);
    if (value === null) return [];
    if (!Array.isArray(value) || value.some((item) => !this.validStudent(item) || item.class_id !== classId)) {
      throw new ServiceUnavailableException("The Simulation photo-review roster state is unavailable.");
    }
    return value;
  }

  private validSimulationSession(value: unknown): value is VisionSession {
    if (!value || typeof value !== "object") return false;
    const session = value as Partial<VisionSession>;
    const result = session.result;
    return typeof session.id === "string" && session.id.startsWith("sim-session-")
      && typeof session.class_id === "string" && typeof session.attendance_date === "string"
      && Boolean(result) && result?.provenance?.environment === "simulation"
      && result.provenance.biometric_matching_performed === false
      && result.provenance.automatic_assignments_permitted === false
      && Array.isArray(result.automatic_assignments) && result.automatic_assignments.length === 0
      && Array.isArray(result.faces) && result.faces.length === 0;
  }

  private async response(path: string, init: RequestInit = {}): Promise<Response> {
    assertLiveExternalEffect("Camera inference");
    if (!this.settings.PHOTO_ATTENDANCE_ENABLED) {
      throw new ServiceUnavailableException("Photo attendance is not enabled for this environment.");
    }
    const headers = new Headers(init.headers);
    // Cloud Run reserves the Authorization header for its own identity layer.
    // Use an application-specific header so the shared secret reaches the
    // inference service unchanged on both public and IAM-protected revisions.
    headers.set("X-Edura-Inference-Token", this.settings.PHOTO_ATTENDANCE_API_TOKEN);
    if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await fetch(`${this.settings.PHOTO_ATTENDANCE_BASE_URL.replace(/\/$/, "")}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.settings.PHOTO_ATTENDANCE_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof Error && error.name === "TimeoutError"
          ? "Photo analysis took too long. The manual register is still available."
          : "The local photo-analysis service is unavailable. The manual register is still available.",
      );
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ detail: response.statusText })) as { detail?: unknown };
      const detail = typeof payload.detail === "string" ? payload.detail : "Photo analysis could not be completed.";
      if (response.status === 503) throw new ServiceUnavailableException(detail);
      throw new BadGatewayException(detail);
    }
    return response;
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.response(path, init).then((response) => response.json() as Promise<T>);
  }

  health(): Promise<VisionHealth> {
    if (selectedSimulationResources()) {
      return this.capture("health", "health", { synthetic: true, biometric_matching: false }).then(() => ({
        backend: "simulation_manual_review",
        model_loaded: false,
        model_id: "simulation-manual-review-v1",
        model_files_present: true,
        missing_models: [],
        single_operator: true,
        accuracy_validated: false,
        retention_days: 0,
      }));
    }
    return this.json("/health");
  }

  llmStatus(): Promise<VisionLlmStatus> {
    if (selectedSimulationResources()) {
      return this.capture("llm_status", "llm-status", { synthetic: true, external_model_contacted: false }).then(() => ({
        available: false,
        installed: false,
        supports_images: false,
        model: "simulation-manual-review-v1",
        provider: "disabled",
        detail: "Simulation does not contact a vision model. Photos remain a manual-review aid only.",
      }));
    }
    return this.json("/llm/status");
  }

  async classes(): Promise<VisionClass[]> {
    if (selectedSimulationResources()) {
      await this.capture("classes", "classes", { synthetic: true });
      return this.simulationClasses();
    }
    return this.json("/classes");
  }

  async createClass(name: string): Promise<VisionClass> {
    if (selectedSimulationResources()) {
      const classes = await this.simulationClasses();
      const existing = classes.find((item) => item.name === name);
      if (existing) return existing;
      const item: VisionClass = {
        id: `sim-class-${simulationLogicalDigest(name).slice(0, 32)}`,
        name,
        created: executionNow().getTime(),
        student_count: 0,
      };
      await this.writeArtifact("classes", [...classes, item]);
      await this.capture("create_class", name, { synthetic: true, class_ref: simulationLogicalDigest(item.id) });
      return item;
    }
    return this.json("/classes", { method: "POST", body: JSON.stringify({ name }) });
  }

  async students(classId: string): Promise<VisionStudent[]> {
    if (selectedSimulationResources()) {
      await this.capture("students", classId, { synthetic: true, class_ref: simulationLogicalDigest(classId) });
      return this.simulationStudents(classId);
    }
    return this.json(`/classes/${encodeURIComponent(classId)}/students`);
  }

  async createStudent(classId: string, input: {
    roll_number: string;
    name: string;
    authorization_record: string;
  }): Promise<VisionStudent> {
    if (selectedSimulationResources()) {
      const students = await this.simulationStudents(classId);
      const logicalIdentity = `${classId}:${input.authorization_record}:${input.roll_number}`;
      const id = `sim-student-${simulationLogicalDigest(logicalIdentity).slice(0, 32)}`;
      const existing = students.find((item) => item.id === id);
      if (existing) return existing;
      const item: VisionStudent = {
        id,
        class_id: classId,
        roll_number: input.roll_number,
        name: input.name,
        authorization_record: input.authorization_record,
        sample_count: 0,
        suggested_status: "needs_review",
      };
      await this.writeArtifact(`class:${classId}:students`, [...students, item]);
      await this.capture("create_student", logicalIdentity, {
        synthetic: true, class_ref: simulationLogicalDigest(classId), student_ref: simulationLogicalDigest(id),
        authorization_ref_hash: simulationLogicalDigest(input.authorization_record),
      });
      return item;
    }
    return this.json(`/classes/${encodeURIComponent(classId)}/students`, {
      method: "POST",
      body: JSON.stringify({ ...input, authorized: true }),
    });
  }

  async enroll(studentId: string, file: { filename: string; mimetype: string; data: Buffer }) {
    if (selectedSimulationResources()) {
      const ledgerValue = await this.readArtifact(`student:${studentId}:samples`);
      const prior = typeof ledgerValue === "number" && Number.isSafeInteger(ledgerValue) && ledgerValue >= 0
        ? ledgerValue : 0;
      const total = prior + 1;
      await this.writeArtifact(`student:${studentId}:samples`, total);
      await this.capture("enroll", `${studentId}:${simulationLogicalDigest(file.data)}`, {
        synthetic: true,
        student_ref: simulationLogicalDigest(studentId),
        media_hash: simulationLogicalDigest(file.data),
        size_bytes: file.data.length,
        biometric_reference_created: false,
        manual_review_only: true,
      });
      return { student_id: studentId, model_id: "simulation-manual-review-v1", added: 1, total_samples: total };
    }
    const body = new FormData();
    body.append("files", new Blob([new Uint8Array(file.data)], { type: file.mimetype }), file.filename);
    body.set("config", "{}");
    return this.json<{ student_id: string; model_id: string; added: number; total_samples: number }>(
      `/students/${encodeURIComponent(studentId)}/samples`,
      { method: "POST", body },
    );
  }

  async analyze(classId: string, input: {
    file: { filename: string; mimetype: string; data: Buffer };
    date: string;
    period: string;
    useLlm: boolean;
  }): Promise<VisionSession> {
    if (selectedSimulationResources()) {
      const selected = selectedSimulationResources();
      if (!selected) throw new Error("Simulation vision state was requested outside Simulation.");
      const mediaHash = simulationLogicalDigest(input.file.data);
      const logicalKey = `${selected.environment.run_id}:${classId}:${input.date}:${input.period}:${mediaHash}`;
      const id = `sim-session-${simulationLogicalDigest(logicalKey).slice(0, 32)}`;
      const existing = await this.readArtifact(`session:${id}`);
      if (existing !== null) {
        if (!this.validSimulationSession(existing)) {
          throw new ServiceUnavailableException("The Simulation photo-review result is unavailable.");
        }
        return existing;
      }
      const roster = await this.simulationStudents(classId);
      const session: VisionSession = {
        id,
        class_id: classId,
        attendance_date: input.date,
        period: input.period,
        version: 1,
        confirmed: 0,
        result: {
          model_id: "simulation-manual-review-v1",
          analysis_mode: "face_embeddings",
          roster,
          faces: [],
          automatic_assignments: [],
          summary: {
            detected_faces: 0,
            auto_present: 0,
            roster_needs_review: roster.length,
            face_needs_review: 0,
          },
          warnings: [
            "Simulation did not send this image to a biometric or multimodal provider.",
            "No identity matches or automatic attendance assignments were generated. Use manual review.",
          ],
          elapsed_seconds: 0,
          provenance: {
            environment: "simulation",
            decision_mode: "synthetic_manual_review",
            biometric_matching_performed: false,
            automatic_assignments_permitted: false,
            source_media_retained: false,
          },
        },
      };
      await this.writeArtifact(`session:${id}`, session);
      await this.capture("analyze", logicalKey, {
        synthetic: true,
        class_ref: simulationLogicalDigest(classId),
        media_hash: mediaHash,
        size_bytes: input.file.data.length,
        requested_multimodal: input.useLlm,
        provider_contacted: false,
        biometric_matching_performed: false,
        automatic_assignments: 0,
      });
      return session;
    }
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(input.file.data)], { type: input.file.mimetype }), input.file.filename);
    body.set("attendance_date", input.date);
    body.set("period", input.period);
    body.set("authorized", "true");
    body.set("config", "{}");
    body.set("use_llm", String(input.useLlm));
    return this.json(`/classes/${encodeURIComponent(classId)}/sessions`, { method: "POST", body });
  }

  async session(sessionId: string): Promise<VisionSession> {
    if (selectedSimulationResources()) {
      const value = await this.readArtifact(`session:${sessionId}`);
      if (!this.validSimulationSession(value)) {
        throw new ServiceUnavailableException("The Simulation photo-review result is unavailable.");
      }
      await this.capture("session", sessionId, { synthetic: true, session_ref: simulationLogicalDigest(sessionId) });
      return value;
    }
    return this.json(`/sessions/${encodeURIComponent(sessionId)}`);
  }
}
