import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { config } from "../config.js";
import { DatabaseService } from "../database/database.service.js";
import { SchoolService } from "../school/school.service.js";
import type { PhotoAttendanceAnalysis, VisionSession } from "./contracts.js";
import { PhotoAttendanceVisionClient } from "./vision-client.js";

export interface UploadedPhoto {
  filename: string;
  mimetype: string;
  data: Buffer;
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const enrollmentSchema = z.object({
  class_section_id: z.string().uuid(),
  date: z.string().regex(datePattern),
  authorization_reference: z.string().trim().min(3).max(500),
  confirmed_authority: z.literal("true"),
});
const analysisSchema = z.object({
  date: z.string().regex(datePattern),
  period: z.string().trim().min(1).max(100),
  authorization_reference: z.string().trim().min(3).max(500),
  confirmed_authority: z.literal("true"),
  analysis_mode: z.enum(["face_embeddings", "local_llm"]).default("face_embeddings"),
});

@Injectable()
export class PhotoAttendanceService {
  private readonly settings = config();

  constructor(
    private readonly db: DatabaseService,
    private readonly school: SchoolService,
    private readonly vision: PhotoAttendanceVisionClient,
  ) {}

  private validatePhoto(photo: UploadedPhoto): void {
    const supported = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ]);
    if (!supported.has(photo.mimetype.toLowerCase())) {
      throw new BadRequestException("Use a JPEG, PNG, WebP, HEIC or HEIF photo.");
    }
    if (!photo.data.length) throw new BadRequestException("The selected photo is empty.");
    if (photo.data.length > 24 * 1024 * 1024) {
      throw new BadRequestException("The selected photo exceeds the 24 MB limit.");
    }
  }

  private async membership(user: AuthUser, schoolId: string) {
    const membership = await this.db
      .selectFrom("school_memberships")
      .select(["id", "role"])
      .where("user_id", "=", user.id)
      .where("school_id", "=", schoolId)
      .where("role", "in", ["staff", "admin"])
      .where("is_active", "=", true)
      .executeTakeFirst();
    if (!membership) throw new ForbiddenException("An active school staff membership is required.");
    return membership;
  }

  private async requirePrincipal(user: AuthUser, schoolId: string) {
    const membership = await this.membership(user, schoolId);
    if (membership.role !== "admin") {
      throw new ForbiddenException("A principal must record and manage face-reference authorization.");
    }
    return membership;
  }

  async setup(user: AuthUser, classSectionId: string, date: string) {
    const screen = await this.school.teacherAttendanceScreen(user, classSectionId, date);
    const membership = await this.membership(user, screen.class.school_id);
    const profiles = await this.db
      .selectFrom("photo_attendance_profiles")
      .select(["student_id", "sample_count", "model_id", "updated_at"])
      .where("school_id", "=", screen.class.school_id)
      .where("class_section_id", "=", classSectionId)
      .where("revoked_at", "is", null)
      .execute();
    const byStudent = new Map(profiles.map((profile) => [profile.student_id, profile]));
    let health: Awaited<ReturnType<PhotoAttendanceVisionClient["health"]>> | null = null;
    let llm: Awaited<ReturnType<PhotoAttendanceVisionClient["llmStatus"]>> | null = null;
    let unavailableReason: string | null = null;
    if (this.settings.PHOTO_ATTENDANCE_ENABLED) {
      try {
        health = await this.vision.health();
        if (!health.model_files_present) unavailableReason = "The local face models are not installed.";
        llm = await this.vision.llmStatus().catch(() => null);
      } catch (error) {
        unavailableReason = error instanceof Error ? error.message : "The local photo-analysis service is unavailable.";
      }
    } else {
      unavailableReason = "Photo attendance is disabled for this environment.";
    }
    return {
      enabled: this.settings.PHOTO_ATTENDANCE_ENABLED,
      available: Boolean(health?.model_files_present),
      unavailable_reason: unavailableReason,
      accuracy_validated: false,
      role: membership.role,
      class: screen.class,
      register: screen.register,
      attendance: screen.availability,
      enrolled_count: profiles.filter((profile) => profile.sample_count > 0).length,
      students: screen.roster.map((student) => {
        const profile = byStudent.get(student.id);
        return {
          student_id: student.id,
          name: student.name,
          roll_number: student.roll_number,
          admission_number: student.admission_number,
          avatar_url: student.avatar_url,
          sample_count: Number(profile?.sample_count ?? 0),
          model_id: profile?.model_id ?? null,
          enrolled_at: profile?.updated_at ?? null,
        };
      }),
      model: health ? { backend: health.backend, id: health.model_id, loaded: health.model_loaded } : null,
      ai_assist: {
        available: Boolean(llm?.available && llm.installed && llm.supports_images !== false),
        model: llm?.model ?? null,
        unavailable_reason: llm?.available && !llm.installed
          ? `The local vision model ${llm.model} is not installed.`
          : llm?.supports_images === false
            ? llm.detail ?? `The local model ${llm.model} does not support image input.`
            : llm?.detail ?? (llm ? null : "The local AI cross-check is unavailable."),
      },
      boundaries: {
        liveness_proven: false,
        automatic_absence: false,
        teacher_confirmation_required: true,
        manual_register_available: true,
      },
    };
  }

  private async ensureProviderClass(
    schoolId: string,
    classSectionId: string,
    className: string,
    actorId: string,
  ): Promise<string> {
    const binding = await this.db
      .selectFrom("photo_attendance_class_bindings")
      .selectAll()
      .where("school_id", "=", schoolId)
      .where("class_section_id", "=", classSectionId)
      .executeTakeFirst();
    const classes = await this.vision.classes();
    if (binding && classes.some((item) => item.id === binding.provider_class_id)) {
      return binding.provider_class_id;
    }
    const stableName = `Edura ${className} [${classSectionId}]`;
    const provider = classes.find((item) => item.name === stableName) ?? await this.vision.createClass(stableName);
    if (binding) {
      await this.db.transaction().execute(async (tx) => {
        await tx.updateTable("photo_attendance_class_bindings")
          .set({ provider_class_id: provider.id, updated_at: new Date() })
          .where("id", "=", binding.id)
          .execute();
        await tx.updateTable("photo_attendance_profiles")
          .set({ sample_count: 0, model_id: null, revoked_at: new Date(), updated_at: new Date() })
          .where("school_id", "=", schoolId)
          .where("class_section_id", "=", classSectionId)
          .execute();
      });
    } else {
      await this.db.insertInto("photo_attendance_class_bindings").values({
        school_id: schoolId,
        class_section_id: classSectionId,
        provider_class_id: provider.id,
        created_by: actorId,
      }).onConflict((conflict) => conflict.columns(["school_id", "class_section_id"]).doNothing()).execute();
    }
    const current = await this.db.selectFrom("photo_attendance_class_bindings")
      .select("provider_class_id")
      .where("school_id", "=", schoolId)
      .where("class_section_id", "=", classSectionId)
      .executeTakeFirstOrThrow();
    return current.provider_class_id;
  }

  private async ensureProviderStudent(input: {
    schoolId: string;
    classSectionId: string;
    providerClassId: string;
    student: { id: string; name: string; roll_number: number };
    authorizationReference: string;
    actorId: string;
  }) {
    const existing = await this.db.selectFrom("photo_attendance_profiles")
      .selectAll()
      .where("school_id", "=", input.schoolId)
      .where("class_section_id", "=", input.classSectionId)
      .where("student_id", "=", input.student.id)
      .executeTakeFirst();
    const providerStudents = await this.vision.students(input.providerClassId);
    if (existing && !existing.revoked_at && providerStudents.some((item) => item.id === existing.provider_student_id)) {
      return existing;
    }
    const marker = `edura-student:${input.student.id}`;
    const provider = providerStudents.find((item) => item.authorization_record?.includes(marker))
      ?? await this.vision.createStudent(input.providerClassId, {
        roll_number: String(input.student.roll_number),
        name: input.student.name,
        authorization_record: `${input.authorizationReference} | ${marker}`.slice(0, 500),
      });
    if (existing) {
      return this.db.updateTable("photo_attendance_profiles").set({
        provider_class_id: input.providerClassId,
        provider_student_id: provider.id,
        sample_count: Number(provider.sample_count ?? 0),
        model_id: null,
        authorization_reference: input.authorizationReference,
        enrolled_by: input.actorId,
        enrolled_at: new Date(),
        updated_at: new Date(),
        revoked_at: null,
      }).where("id", "=", existing.id).returningAll().executeTakeFirstOrThrow();
    }
    return this.db.insertInto("photo_attendance_profiles").values({
      school_id: input.schoolId,
      class_section_id: input.classSectionId,
      student_id: input.student.id,
      provider_class_id: input.providerClassId,
      provider_student_id: provider.id,
      sample_count: Number(provider.sample_count ?? 0),
      model_id: null,
      authorization_reference: input.authorizationReference,
      enrolled_by: input.actorId,
      revoked_at: null,
    }).returningAll().executeTakeFirstOrThrow();
  }

  async enroll(
    request: AuthenticatedRequest,
    studentId: string,
    fields: Record<string, string>,
    photo: UploadedPhoto,
  ) {
    this.validatePhoto(photo);
    const input = enrollmentSchema.parse(fields);
    const screen = await this.school.teacherAttendanceScreen(request.authUser, input.class_section_id, input.date);
    await this.requirePrincipal(request.authUser, screen.class.school_id);
    const student = screen.roster.find((item) => item.id === studentId);
    if (!student) throw new NotFoundException("The student is not on this class roster for the selected date.");
    const providerClassId = await this.ensureProviderClass(
      screen.class.school_id,
      input.class_section_id,
      screen.class.name,
      request.authUser.id,
    );
    const profile = await this.ensureProviderStudent({
      schoolId: screen.class.school_id,
      classSectionId: input.class_section_id,
      providerClassId,
      student,
      authorizationReference: input.authorization_reference,
      actorId: request.authUser.id,
    });
    const result = await this.vision.enroll(profile.provider_student_id, photo);
    await this.db.transaction().execute(async (tx) => {
      await tx.updateTable("photo_attendance_profiles").set({
        sample_count: result.total_samples,
        model_id: result.model_id,
        authorization_reference: input.authorization_reference,
        updated_at: new Date(),
      }).where("id", "=", profile.id).execute();
      await tx.insertInto("audit_events").values({
        action: "photo_attendance.reference.enrolled",
        actor_id: request.authUser.id,
        school_id: screen.class.school_id,
        target_type: "student",
        target_id: studentId,
        request_id: request.requestId,
        ip_hash: null,
        metadata: {
          class_section_id: input.class_section_id,
          sample_count: result.total_samples,
          model_id: result.model_id,
        },
      }).execute();
    });
    return { student_id: studentId, added: result.added, sample_count: result.total_samples, model_id: result.model_id };
  }

  async analyze(
    request: AuthenticatedRequest,
    classSectionId: string,
    fields: Record<string, string>,
    photo: UploadedPhoto,
  ): Promise<PhotoAttendanceAnalysis> {
    this.validatePhoto(photo);
    const input = analysisSchema.parse(fields);
    const screen = await this.school.teacherAttendanceScreen(request.authUser, classSectionId, input.date);
    await this.membership(request.authUser, screen.class.school_id);
    if (!screen.availability.can_mark) {
      throw new BadRequestException(screen.availability.reason ?? "Attendance is not available for this class and date.");
    }
    if (screen.register.state === "locked") {
      throw new ForbiddenException("This attendance register is locked. Photo suggestions cannot be applied.");
    }
    const providerClassId = await this.ensureProviderClass(
      screen.class.school_id,
      classSectionId,
      screen.class.name,
      request.authUser.id,
    );
    const profiles = await this.db.selectFrom("photo_attendance_profiles")
      .selectAll()
      .where("school_id", "=", screen.class.school_id)
      .where("class_section_id", "=", classSectionId)
      .where("revoked_at", "is", null)
      .where("sample_count", ">", 0)
      .execute();
    if (!profiles.length) {
      throw new BadRequestException("No authorized face references are enrolled for this class. A principal must complete photo setup first.");
    }
    const providerSession = await this.vision.analyze(providerClassId, {
      file: photo,
      date: input.date,
      period: input.period,
      useLlm: input.analysis_mode === "local_llm",
    });
    const observedAt = new Date();
    const inserted = await this.db.transaction().execute(async (tx) => {
      const session = await tx.insertInto("photo_attendance_sessions").values({
        school_id: screen.class.school_id,
        class_section_id: classSectionId,
        term_id: screen.class.term_id,
        date: input.date,
        period: input.period,
        provider_session_id: providerSession.id,
        captured_by: request.authUser.id,
        capture_authorization_reference: input.authorization_reference,
        roster_count: screen.roster.length,
        detected_faces: providerSession.result.summary.detected_faces,
        proposed_present: providerSession.result.summary.auto_present,
        model_id: providerSession.result.model_id,
        analysis_summary: {
          warnings: providerSession.result.warnings,
          elapsed_seconds: providerSession.result.elapsed_seconds,
          enrolled: profiles.length,
        },
        observed_at: observedAt,
        received_at: new Date(),
        expires_at: new Date(Date.now() + 7 * 86_400_000),
        applied_at: null,
        applied_submission_id: null,
      }).returningAll().executeTakeFirstOrThrow();
      await tx.insertInto("audit_events").values({
        action: "photo_attendance.photo.analyzed",
        actor_id: request.authUser.id,
        school_id: screen.class.school_id,
        target_type: "photo_attendance_session",
        target_id: session.id,
        request_id: request.requestId,
        ip_hash: null,
        metadata: {
          class_section_id: classSectionId,
          date: input.date,
          detected_faces: providerSession.result.summary.detected_faces,
          proposed_present: providerSession.result.summary.auto_present,
          model_id: providerSession.result.model_id,
        },
      }).execute();
      return session;
    });
    return this.mapAnalysis(inserted, screen, profiles, providerSession);
  }

  async detail(user: AuthUser, sessionId: string) {
    const stored = await this.db.selectFrom("photo_attendance_sessions")
      .selectAll().where("id", "=", sessionId).executeTakeFirst();
    if (!stored) throw new NotFoundException("Photo-attendance analysis not found.");
    if (stored.expires_at < new Date()) throw new NotFoundException("Photo-attendance analysis has expired.");
    const screen = await this.school.teacherAttendanceScreen(user, stored.class_section_id, String(stored.date));
    const profiles = await this.db.selectFrom("photo_attendance_profiles")
      .selectAll().where("school_id", "=", stored.school_id)
      .where("class_section_id", "=", stored.class_section_id)
      .where("revoked_at", "is", null).execute();
    return this.mapAnalysis(stored, screen, profiles, await this.vision.session(stored.provider_session_id));
  }

  private mapAnalysis(
    stored: any,
    screen: Awaited<ReturnType<SchoolService["teacherAttendanceScreen"]>>,
    profiles: Array<{ student_id: string; provider_student_id: string; sample_count: number }>,
    provider: VisionSession,
  ): PhotoAttendanceAnalysis {
    const byProvider = new Map(profiles.map((item) => [item.provider_student_id, item]));
    const byStudent = new Map(profiles.map((item) => [item.student_id, item]));
    const nameByStudent = new Map(screen.roster.map((item) => [item.id, item.name]));
    const assignmentByProvider = new Map(
      provider.result.automatic_assignments.map((item) => [item.student_id, item.face_id]),
    );
    const automaticPresent = new Set(provider.result.automatic_assignments.map((item) => byProvider.get(item.student_id)?.student_id).filter(Boolean));
    const warnings = [
      ...provider.result.warnings.filter((warning) => !warning.toLowerCase().includes("uncalibrated scores")),
      "Photo matches are suggestions only. Review every student before submitting the register.",
      "A student who is not seen remains unmarked; the system never infers absence from a photo.",
    ];
    return {
      id: stored.id,
      state: stored.state,
      class_section_id: stored.class_section_id,
      date: String(stored.date).slice(0, 10),
      period: stored.period,
      observed_at: new Date(stored.observed_at).toISOString(),
      expires_at: new Date(stored.expires_at).toISOString(),
      model: { id: provider.result.model_id, accuracy_validated: false },
      analysis_mode: provider.result.analysis_mode,
      summary: {
        roster: screen.roster.length,
        enrolled: profiles.filter((profile) => profile.sample_count > 0).length,
        detected_faces: provider.result.summary.detected_faces,
        proposed_present: automaticPresent.size,
        needs_review: screen.roster.length - automaticPresent.size,
        elapsed_seconds: provider.result.elapsed_seconds,
      },
      warnings,
      students: screen.roster.map((student) => {
        const profile = byStudent.get(student.id);
        return {
          student_id: student.id,
          name: student.name,
          roll_number: student.roll_number,
          admission_number: student.admission_number,
          avatar_url: student.avatar_url,
          current_status: student.status,
          sample_count: Number(profile?.sample_count ?? 0),
          proposal: automaticPresent.has(student.id) ? "present" as const : "needs_review" as const,
          face_id: profile ? assignmentByProvider.get(profile.provider_student_id) ?? null : null,
        };
      }),
      faces: provider.result.faces.map((face) => {
        const mapped = face.student_id ? byProvider.get(face.student_id) : undefined;
        return {
          face_id: face.face_id,
          state: face.state,
          student_id: mapped?.student_id ?? null,
          student_name: mapped ? nameByStudent.get(mapped.student_id) ?? null : null,
          similarity: face.score,
          thumbnail: face.thumbnail.startsWith("data:")
            ? face.thumbnail
            : `data:image/jpeg;base64,${face.thumbnail}`,
          reasons: face.reasons,
          candidates: face.candidates.flatMap((candidate) => {
            const profile = byProvider.get(candidate.student_id);
            return profile ? [{
              student_id: profile.student_id,
              name: nameByStudent.get(profile.student_id) ?? "Student",
              similarity: candidate.score,
            }] : [];
          }),
        };
      }),
    };
  }
}
