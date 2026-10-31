import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import { mkdir, readEnvironmentStoredFile, rename, unlink, writeFile } from "../common/environment-files.js";
import { config } from "../config.js";
const limit = 10 * 1024 * 1024;
/** Assessments own acceptance; these bytes use the existing selected-world artifact port. */
export function assessmentEvidenceMetadata(upload) {
    const bytes = upload.data, contentType = upload.mimetype.split(";", 1)[0].trim().toLowerCase();
    if (!bytes.length || bytes.length > limit)
        throw new BadRequestException("Evidence must be a PDF, JPEG or PNG up to 10 MB.");
    const valid = contentType === "application/pdf" && bytes.subarray(0, 5).toString() === "%PDF-"
        || contentType === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || contentType === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!valid)
        throw new BadRequestException("Use a PDF, JPEG or PNG with matching file contents.");
    return { original_name: upload.filename.split(/[\\/]/u).pop()?.replace(/\p{Cc}/gu, "_").slice(0, 255) || "assessment-evidence",
        content_type: contentType, size_bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
function paths(schoolId, assessmentId, storageKey) {
    z.uuid().parse(schoolId);
    z.uuid().parse(assessmentId);
    if (!/^[a-f0-9-]{36}(?:\.(?:pdf|jpe?g|png))?$/iu.test(storageKey))
        throw new ConflictException("The evidence reference is unavailable.");
    const directory = join(config().uploadDir, "assessments", schoolId, assessmentId);
    return { directory, pending: join(directory, `.${storageKey}.pending`), final: join(directory, storageKey) };
}
export async function readAssessmentEvidenceArtifact(schoolId, assessmentId, record) {
    const path = paths(schoolId, assessmentId, record.storage_key).final;
    try {
        const found = await readEnvironmentStoredFile(path, record.content_type, record.original_name);
        // A privacy-safe captured placeholder is a useful preview, never accepted bytes.
        if (found.source_content_omitted)
            return { ...found, sha256: null };
        const chunks = [];
        let size = 0;
        for await (const part of found.stream) {
            const chunk = Buffer.from(part);
            size += chunk.length;
            if (size > limit) {
                found.stream.destroy();
                throw new ConflictException("The stored evidence failed its integrity check.");
            }
            chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks), hash = createHash("sha256").update(bytes).digest("hex");
        if (size !== record.size_bytes || record.sha256 !== null && hash !== record.sha256)
            throw new ConflictException("The stored evidence failed its integrity check. Add a replacement before submitting.");
        return { ...found, stream: Readable.from([bytes]), size_bytes: size, sha256: hash };
    }
    catch (cause) {
        if (cause instanceof ConflictException)
            throw cause;
        throw new ConflictException({ code: "assessment_evidence_unavailable", message: "The evidence file is unavailable. Add a replacement before submitting." });
    }
}
export async function putAssessmentEvidenceArtifact(schoolId, assessmentId, record, bytes) {
    const path = paths(schoolId, assessmentId, record.storage_key);
    await mkdir(path.directory, { recursive: true, mode: 0o750 });
    // Never overwrite an uncertain earlier immutable upload. An exact retry may
    // reuse only bytes whose complete digest and length match this commitment.
    try {
        const existing = await readAssessmentEvidenceArtifact(schoolId, assessmentId, record);
        existing.stream.destroy();
        if (!existing.source_content_omitted && existing.sha256 === record.sha256)
            return;
    }
    catch (cause) {
        if (!(cause instanceof ConflictException) || typeof cause.getResponse() !== "object"
            || cause.getResponse().code !== "assessment_evidence_unavailable")
            throw cause;
    }
    await writeFile(path.pending, bytes, { flag: "wx", mode: 0o640 });
    await rename(path.pending, path.final);
    const verified = await readAssessmentEvidenceArtifact(schoolId, assessmentId, record);
    verified.stream.destroy();
    if (verified.source_content_omitted || verified.sha256 !== record.sha256)
        throw new ConflictException("The uploaded evidence could not be verified. Try again.");
}
/** Call only after the owning domain proves this exact generated key unreferenced. */
export async function removeUnacceptedAssessmentEvidenceArtifact(schoolId, assessmentId, storageKey) {
    const path = paths(schoolId, assessmentId, storageKey);
    await unlink(path.pending).catch(() => undefined);
    await unlink(path.final).catch(() => undefined);
}
//# sourceMappingURL=assessment-evidence-artifacts.js.map