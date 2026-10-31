var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, } from "@nestjs/common";
import { z } from "zod";
import { sql } from "kysely";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { DatabaseService } from "../database/database.service.js";
import { SchoolService } from "../school/school.service.js";
import { AttendanceModelService } from "../attendance-model/attendance-model.service.js";
import { PhotoAttendanceVisionClient } from "./vision-client.js";
import { proFeaturesEnabled, requireProFeatures } from '../auth/pro-features.js';
import { findAcademicParticipationRegister } from "../attendance/participation-continuity.js";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const enrollmentSchema = z.object({
    class_section_id: z.string().uuid(),
    date: z.string().regex(datePattern),
    authorization_reference: z.string().trim().min(3).max(500),
    confirmed_authority: z.literal("true"),
    session_id: z.string().uuid().optional(),
});
const analysisSchema = z.object({
    date: z.string().regex(datePattern),
    period: z.string().trim().min(1).max(100),
    authorization_reference: z.string().trim().min(3).max(500),
    confirmed_authority: z.literal("true"),
    analysis_mode: z.enum(["face_embeddings", "multimodal"]).default("face_embeddings"),
    session_id: z.string().uuid().optional(),
});
let PhotoAttendanceService = class PhotoAttendanceService {
    db;
    school;
    vision;
    attendanceModel;
    constructor(db, school, vision, attendanceModel) {
        this.db = db;
        this.school = school;
        this.vision = vision;
        this.attendanceModel = attendanceModel;
    }
    async attendanceScreen(user, classSectionId, date, sessionId) {
        const screen = sessionId
            ? await this.attendanceModel.screen(user, sessionId)
            : await this.school.teacherAttendanceScreen(user, classSectionId, date);
        if (screen.class.id !== classSectionId || screen.date !== date) {
            throw new BadRequestException("The photo must use the open register's class and date.");
        }
        if (sessionId && (!("capture_policy" in screen) || !screen.capture_policy?.channels.includes("camera_assisted"))) {
            throw new BadRequestException("Camera-assisted attendance is not enabled for subject registers.");
        }
        return screen;
    }
    validatePhoto(photo) {
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
        if (!photo.data.length)
            throw new BadRequestException("The selected photo is empty.");
        if (photo.data.length > 24 * 1024 * 1024) {
            throw new BadRequestException("The selected photo exceeds the 24 MB limit.");
        }
    }
    async membership(user, schoolId) {
        const membership = await this.db
            .selectFrom("school_memberships")
            .select(["id", "role"])
            .where("user_id", "=", user.id)
            .where("school_id", "=", schoolId)
            .where("role", "in", ["staff", "admin"])
            .where("is_active", "=", true)
            .executeTakeFirst();
        if (!membership)
            throw new ForbiddenException("An active school staff membership is required.");
        return membership;
    }
    async requirePrincipal(user, schoolId) {
        const membership = await this.membership(user, schoolId);
        if (membership.role !== "admin") {
            throw new ForbiddenException("A principal must record and manage face-reference authorization.");
        }
        return membership;
    }
    async requireClassPhotoAccess(user, schoolId, classId, date) {
        const membership = await this.membership(user, schoolId);
        if (membership.role !== "admin" && !(await sql `SELECT staff_has_class_permission(${schoolId}::uuid,${user.id}::uuid,'photo.use',${classId}::uuid,${date}::date) AS allowed`.execute(this.db)).rows[0]?.allowed)
            throw new ForbiddenException("Your assignment does not allow photo attendance for this class.");
    }
    async setup(user, classSectionId, date, sessionId) {
        const previewEnabled = await proFeaturesEnabled(this.db, user.id);
        const screen = await this.attendanceScreen(user, classSectionId, date, sessionId);
        const membership = await this.membership(user, screen.class.school_id);
        await this.requireClassPhotoAccess(user, screen.class.school_id, classSectionId, date);
        const profiles = await this.db
            .selectFrom("photo_attendance_profiles")
            .select(["student_id", "sample_count", "model_id", "updated_at"])
            .where("school_id", "=", screen.class.school_id)
            .where("class_section_id", "=", classSectionId)
            .where("revoked_at", "is", null)
            .execute();
        const byStudent = new Map(profiles.map((profile) => [profile.student_id, profile]));
        let health = null;
        let llm = null;
        let unavailableReason = null;
        if (this.vision.available) {
            try {
                health = await this.vision.health();
                if (!health.model_files_present)
                    unavailableReason = "The local face models are not installed.";
                if (previewEnabled)
                    llm = await this.vision.llmStatus().catch(() => null);
            }
            catch (error) {
                unavailableReason = error instanceof Error ? error.message : "The local photo-analysis service is unavailable.";
            }
        }
        else {
            unavailableReason = "Photo attendance is disabled for this environment.";
        }
        return {
            enabled: this.vision.available,
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
                preview_enabled: previewEnabled,
                available: previewEnabled && Boolean(llm?.available && llm.installed && llm.supports_images !== false),
                model: llm?.model ?? null,
                provider: llm?.provider ?? null,
                unavailable_reason: llm?.available && !llm.installed
                    ? `The vision model ${llm.model} is not available.`
                    : llm?.supports_images === false
                        ? llm.detail ?? `The model ${llm.model} does not support image input.`
                        : llm?.detail ?? (llm ? null : "The multimodal cross-check is unavailable."),
            },
            boundaries: {
                liveness_proven: false,
                automatic_absence: false,
                teacher_confirmation_required: true,
                manual_register_available: true,
            },
        };
    }
    async ensureProviderClass(schoolId, classSectionId, className, actorId) {
        const binding = await this.db
            .selectFrom("photo_attendance_class_bindings")
            .selectAll()
            .where("school_id", "=", schoolId)
            .where("class_section_id", "=", classSectionId)
            .executeTakeFirst();
        if (binding && this.vision.simulationActive)
            return binding.provider_class_id;
        const classes = await this.vision.classes();
        if (binding && classes.some((item) => item.id === binding.provider_class_id)) {
            return binding.provider_class_id;
        }
        const stableName = `ThatCampus ${className} [${classSectionId}]`;
        const provider = classes.find((item) => item.name === stableName) ?? await this.vision.createClass(stableName);
        if (binding) {
            await this.db.transaction().execute(async (tx) => {
                await tx.updateTable("photo_attendance_class_bindings")
                    .set({ provider_class_id: provider.id, updated_at: executionNow() })
                    .where("id", "=", binding.id)
                    .execute();
                await tx.updateTable("photo_attendance_profiles")
                    .set({ sample_count: 0, model_id: null, revoked_at: executionNow(), updated_at: executionNow() })
                    .where("school_id", "=", schoolId)
                    .where("class_section_id", "=", classSectionId)
                    .execute();
            });
        }
        else {
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
    async ensureProviderStudent(input) {
        const existing = await this.db.selectFrom("photo_attendance_profiles")
            .selectAll()
            .where("school_id", "=", input.schoolId)
            .where("class_section_id", "=", input.classSectionId)
            .where("student_id", "=", input.student.id)
            .executeTakeFirst();
        if (existing && !existing.revoked_at && this.vision.simulationActive)
            return existing;
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
                enrolled_at: executionNow(),
                updated_at: executionNow(),
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
    async enroll(request, studentId, fields, photo) {
        this.validatePhoto(photo);
        const input = enrollmentSchema.parse(fields);
        const screen = await this.attendanceScreen(request.authUser, input.class_section_id, input.date, input.session_id);
        await this.requirePrincipal(request.authUser, screen.class.school_id);
        const student = screen.roster.find((item) => item.id === studentId);
        if (!student)
            throw new NotFoundException("The student is not on this class roster for the selected date.");
        const providerClassId = await this.ensureProviderClass(screen.class.school_id, input.class_section_id, screen.class.name, request.authUser.id);
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
                updated_at: executionNow(),
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
    async analyze(request, classSectionId, fields, photo) {
        this.validatePhoto(photo);
        const input = analysisSchema.parse(fields);
        if (input.analysis_mode === 'multimodal')
            await requireProFeatures(this.db, request.authUser.id);
        const screen = await this.attendanceScreen(request.authUser, classSectionId, input.date, input.session_id);
        await this.membership(request.authUser, screen.class.school_id);
        await this.requireClassPhotoAccess(request.authUser, screen.class.school_id, classSectionId, input.date);
        if (!screen.availability.can_mark) {
            throw new BadRequestException(screen.availability.reason ?? "Attendance is not available for this class and date.");
        }
        if (screen.register.state === "locked") {
            throw new ForbiddenException("This attendance register is locked. Photo suggestions cannot be applied.");
        }
        const providerClassId = await this.ensureProviderClass(screen.class.school_id, classSectionId, screen.class.name, request.authUser.id);
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
            useLlm: input.analysis_mode === "multimodal",
        });
        const observedAt = executionNow();
        const inserted = await this.db.transaction().execute(async (tx) => {
            const participation = await findAcademicParticipationRegister(tx, { school_id: screen.class.school_id,
                class_section_id: classSectionId, term_id: screen.class.term_id, date: input.date, attendance_session_id: input.session_id ?? null });
            const session = await tx.insertInto("photo_attendance_sessions").values({
                school_id: screen.class.school_id,
                class_section_id: classSectionId,
                term_id: screen.class.term_id,
                attendance_session_id: input.session_id ?? null,
                participation_register_id: participation?.register_id ?? null,
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
                    matched_student_ids: providerSession.result.automatic_assignments
                        .map((assignment) => profiles.find((profile) => profile.provider_student_id === assignment.student_id)?.student_id)
                        .filter((studentId) => Boolean(studentId)),
                },
                observed_at: observedAt,
                received_at: executionNow(),
                expires_at: new Date(executionNow().getTime() + 7 * 86_400_000),
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
    async detail(user, sessionId) {
        const stored = await this.db.selectFrom("photo_attendance_sessions")
            .selectAll().where("id", "=", sessionId).executeTakeFirst();
        if (!stored)
            throw new NotFoundException("Photo-attendance analysis not found.");
        if (stored.expires_at < executionNow())
            throw new NotFoundException("Photo-attendance analysis has expired.");
        const screen = await this.attendanceScreen(user, stored.class_section_id, String(stored.date), stored.attendance_session_id ?? undefined);
        await this.requireClassPhotoAccess(user, stored.school_id, stored.class_section_id, String(stored.date));
        const profiles = await this.db.selectFrom("photo_attendance_profiles")
            .selectAll().where("school_id", "=", stored.school_id)
            .where("class_section_id", "=", stored.class_section_id)
            .where("revoked_at", "is", null).execute();
        return this.mapAnalysis(stored, screen, profiles, await this.vision.session(stored.provider_session_id));
    }
    mapAnalysis(stored, screen, profiles, provider) {
        const byProvider = new Map(profiles.map((item) => [item.provider_student_id, item]));
        const byStudent = new Map(profiles.map((item) => [item.student_id, item]));
        const nameByStudent = new Map(screen.roster.map((item) => [item.id, item.name]));
        const assignmentByProvider = new Map(provider.result.automatic_assignments.map((item) => [item.student_id, item.face_id]));
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
            provenance: provider.result.provenance,
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
                    proposal: automaticPresent.has(student.id) ? "present" : "needs_review",
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
};
PhotoAttendanceService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService,
        SchoolService,
        PhotoAttendanceVisionClient,
        AttendanceModelService])
], PhotoAttendanceService);
export { PhotoAttendanceService };
//# sourceMappingURL=photo-attendance.service.js.map