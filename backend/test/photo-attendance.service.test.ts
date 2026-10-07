import { describe, expect, it } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { SchoolService } from "../src/school/school.service.js";
import type { PhotoAttendanceAnalysis, VisionSession } from "../src/photo-attendance/contracts.js";
import { PhotoAttendanceService } from "../src/photo-attendance/photo-attendance.service.js";
import type { PhotoAttendanceVisionClient } from "../src/photo-attendance/vision-client.js";

type Screen = Awaited<ReturnType<SchoolService["teacherAttendanceScreen"]>>;
type Mapper = (
  stored: Record<string, unknown>,
  screen: Screen,
  profiles: Array<{ student_id: string; provider_student_id: string; sample_count: number }>,
  provider: VisionSession,
) => PhotoAttendanceAnalysis;

function mapper(): Mapper {
  process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/omnischool_test";
  const service = new PhotoAttendanceService(
    {} as DatabaseService,
    {} as SchoolService,
    {} as PhotoAttendanceVisionClient,
  );
  return (service as unknown as { mapAnalysis: Mapper }).mapAnalysis.bind(service);
}

describe("photo attendance proposal mapping", () => {
  it("suggests present only for automatic one-to-one assignments and never infers absence", () => {
    const screen = {
      roster: [
        { id: "student-1", name: "Aarav Sharma", roll_number: 1, admission_number: "CIS-001", avatar_url: "", status: null },
        { id: "student-2", name: "Ananya Iyer", roll_number: 2, admission_number: "CIS-002", avatar_url: "", status: null },
      ],
    } as unknown as Screen;
    const provider = {
      result: {
        model_id: "synthetic-v1",
        analysis_mode: "face_embeddings",
        automatic_assignments: [{ face_id: "f001", student_id: "provider-1", source: "face_embeddings" }],
        summary: { detected_faces: 1, auto_present: 1, roster_needs_review: 1, face_needs_review: 0 },
        warnings: ["Uncalibrated scores: test warning"],
        elapsed_seconds: 0.25,
        faces: [{
          face_id: "f001",
          student_id: "provider-1",
          state: "auto",
          score: 0.82,
          margin: 0.2,
          conflict_margin: 0.2,
          box: [0, 0, 40, 40],
          thumbnail: "dGVzdA==",
          reasons: [],
          candidates: [{ student_id: "provider-1", score: 0.82 }],
          quality: { ok: true, reasons: [], face_pixels: 40, blur: 100 },
        }],
      },
    } as unknown as VisionSession;

    const result = mapper()(
      {
        id: "session-1",
        state: "analyzed",
        class_section_id: "class-1",
        date: "2026-09-16",
        period: "Period 1",
        observed_at: new Date("2026-09-16T04:00:00Z"),
        expires_at: new Date("2026-09-23T04:00:00Z"),
      },
      screen,
      [
        { student_id: "student-1", provider_student_id: "provider-1", sample_count: 2 },
        { student_id: "student-2", provider_student_id: "provider-2", sample_count: 2 },
      ],
      provider,
    );

    expect(result.students).toMatchObject([
      { student_id: "student-1", proposal: "present", face_id: "f001" },
      { student_id: "student-2", proposal: "needs_review", face_id: null },
    ]);
    expect(result.students.map((student) => student.proposal)).not.toContain("absent");
    expect(result.summary).toMatchObject({ proposed_present: 1, needs_review: 1 });
    expect(result.analysis_mode).toBe("face_embeddings");
    expect(result.faces[0]?.thumbnail).toBe("data:image/jpeg;base64,dGVzdA==");
    expect(result.warnings).toContain("A student who is not seen remains unmarked; the system never infers absence from a photo.");
  });
});
