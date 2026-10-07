import { BadGatewayException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { config } from "../config.js";
import type { VisionClass, VisionHealth, VisionLlmStatus, VisionSession, VisionStudent } from "./contracts.js";

@Injectable()
export class PhotoAttendanceVisionClient {
  private readonly settings = config();

  private async response(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.settings.PHOTO_ATTENDANCE_ENABLED) {
      throw new ServiceUnavailableException("Photo attendance is not enabled for this environment.");
    }
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.settings.PHOTO_ATTENDANCE_API_TOKEN}`);
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
    return this.json("/health");
  }

  llmStatus(): Promise<VisionLlmStatus> {
    return this.json("/llm/status");
  }

  classes(): Promise<VisionClass[]> {
    return this.json("/classes");
  }

  createClass(name: string): Promise<VisionClass> {
    return this.json("/classes", { method: "POST", body: JSON.stringify({ name }) });
  }

  students(classId: string): Promise<VisionStudent[]> {
    return this.json(`/classes/${encodeURIComponent(classId)}/students`);
  }

  createStudent(classId: string, input: {
    roll_number: string;
    name: string;
    authorization_record: string;
  }): Promise<VisionStudent> {
    return this.json(`/classes/${encodeURIComponent(classId)}/students`, {
      method: "POST",
      body: JSON.stringify({ ...input, authorized: true }),
    });
  }

  enroll(studentId: string, file: { filename: string; mimetype: string; data: Buffer }) {
    const body = new FormData();
    body.append("files", new Blob([new Uint8Array(file.data)], { type: file.mimetype }), file.filename);
    body.set("config", "{}");
    return this.json<{ student_id: string; model_id: string; added: number; total_samples: number }>(
      `/students/${encodeURIComponent(studentId)}/samples`,
      { method: "POST", body },
    );
  }

  analyze(classId: string, input: {
    file: { filename: string; mimetype: string; data: Buffer };
    date: string;
    period: string;
    useLlm: boolean;
  }): Promise<VisionSession> {
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(input.file.data)], { type: input.file.mimetype }), input.file.filename);
    body.set("attendance_date", input.date);
    body.set("period", input.period);
    body.set("authorized", "true");
    body.set("config", "{}");
    body.set("use_llm", String(input.useLlm));
    return this.json(`/classes/${encodeURIComponent(classId)}/sessions`, { method: "POST", body });
  }

  session(sessionId: string): Promise<VisionSession> {
    return this.json(`/sessions/${encodeURIComponent(sessionId)}`);
  }
}
