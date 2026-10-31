var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Readable } from "node:stream";
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { z } from "zod";
import { config } from "../config.js";
import { mkdir, readEnvironmentStoredFile, writeFile } from "../common/environment-files.js";
export const REPAIR_PHOTO_LIMIT = 5 * 1024 * 1024;
/** Validate bytes before a domain transaction; never trust a browser extension. */
export function repairPhotoMetadata(upload) {
    const bytes = upload.data;
    if (!bytes.length || bytes.length > REPAIR_PHOTO_LIMIT)
        throw new BadRequestException("Choose a non-empty photo up to 5 MiB.");
    const type = upload.mimetype.split(";", 1)[0].trim().toLowerCase();
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!(type === "image/png" && png || type === "image/jpeg" && jpeg))
        throw new BadRequestException("Use a PNG or JPEG photo with matching file contents.");
    const name = upload.filename.split(/[\\/]/u).pop()?.replace(/\p{Cc}/gu, "_").slice(0, 180) || "repair-photo";
    return { original_name: name, content_type: type, size_bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex") };
}
/** Private bytes only. Facilities owns authorization and metadata/state changes. */
let FacilitiesArtifactStore = class FacilitiesArtifactStore {
    path(school, repair, photo) {
        for (const value of [school, repair, photo])
            z.uuid().parse(value);
        return join(config().uploadDir, "facilities", school, repair, photo);
    }
    async put(school, repair, photo, bytes, contentType) {
        const path = this.path(school, repair, photo);
        await mkdir(join(config().uploadDir, "facilities", school, repair), { recursive: true, mode: 0o750 });
        try {
            await writeFile(path, bytes, { flag: "wx", mode: 0o640 });
        }
        catch (cause) {
            // Ambiguous commit/retry may leave immutable bytes. Reuse only exact bytes;
            // never overwrite an earlier attachment or consult Live in Simulation.
            const existing = await readEnvironmentStoredFile(path, contentType, "repair-photo");
            if (existing.source_content_omitted)
                throw cause;
            const chunks = [];
            let size = 0;
            for await (const part of existing.stream) {
                const chunk = Buffer.from(part);
                size += chunk.length;
                if (size > REPAIR_PHOTO_LIMIT)
                    throw cause;
                chunks.push(chunk);
            }
            if (!Buffer.concat(chunks).equals(bytes))
                throw cause;
        }
    }
    async read(school, repair, photo, contentType, name, expectedSize, expectedHash) {
        const result = await readEnvironmentStoredFile(this.path(school, repair, photo), contentType, name);
        if (result.source_content_omitted)
            return result;
        const chunks = [];
        let size = 0;
        for await (const part of result.stream) {
            const chunk = Buffer.from(part);
            size += chunk.length;
            if (size > REPAIR_PHOTO_LIMIT)
                throw new ConflictException("The stored photo failed its integrity check.");
            chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        if (size !== expectedSize || createHash("sha256").update(bytes).digest("hex") !== expectedHash)
            throw new ConflictException("The stored photo failed its integrity check. Its recorded evidence is retained.");
        return { ...result, stream: Readable.from([bytes]), size_bytes: size };
    }
};
FacilitiesArtifactStore = __decorate([
    Injectable()
], FacilitiesArtifactStore);
export { FacilitiesArtifactStore };
//# sourceMappingURL=facilities-artifacts.js.map