import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthUser } from "../common/request.js";
import { sql } from "kysely";
import { DatabaseService } from "../database/database.service.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { mkdir, writeFile, readEnvironmentStoredFile } from "../common/environment-files.js";
import { config } from "../config.js";
import { selectedSimulationResources } from "../common/simulation-resources.js";
import { TeachingSessionContextService } from "./teaching-session-context.service.js";
import { TeachingSessionModelService } from "./teaching-session-model.service.js";
import { sessionFile, sessionMaterial, sessionUuid, type SessionUpload } from "./teaching-session.contracts.js";

@Injectable()
export class TeachingSessionArtifactStore {
  private path(school: string, session: string, key: string) {
    sessionUuid.parse(school); sessionUuid.parse(session); sessionUuid.parse(key);
    return join(config().uploadDir,"teaching",school,session,key);
  }
  async put(school: string, session: string, key: string, data: Buffer, type: string) {
    const path = this.path(school,session,key), directory = join(config().uploadDir,"teaching",school,session);
    await mkdir(directory,{ recursive: true, mode: 0o750 });
    try { await writeFile(path,data,{flag:"wx",mode:0o640}); }
    catch (cause) {
      // A response-lost upload may leave immutable bytes. Reuse only exact bytes;
      // never overwrite or remove an uncertain attachment.
      const existing = await this.read(school,session,key,type,"attachment");
      const chunks: Buffer[] = []; for await (const chunk of existing.stream) chunks.push(Buffer.from(chunk));
      if (existing.source_content_omitted || !Buffer.concat(chunks).equals(data)) throw cause;
    }
  }
  read(school: string, session: string, key: string, type: string, name: string) {
    return readEnvironmentStoredFile(this.path(school,session,key),type,name);
  }
}

export function teachingMaterialType(upload: SessionUpload) {
  const bytes = upload.data, type = upload.mimetype.split(";",1)[0]!.toLowerCase();
  if (!bytes.length || bytes.length > 5*1024*1024) throw new BadRequestException("Choose a non-empty file up to 5 MiB.");
  if (type === "application/pdf" && bytes.subarray(0,5).toString() === "%PDF-") return type;
  if (type === "image/png" && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return type;
  if (type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return type;
  if (["text/plain","application/octet-stream","text/javascript","application/javascript","text/x-python","text/markdown","text/csv"].includes(type)
    && /\.(?:txt|csv|md|py|js|ts|java|c|cpp|html|css)$/iu.test(upload.filename)) {
    try { new TextDecoder("utf-8",{fatal:true}).decode(bytes); if (!bytes.includes(0)) return "text/plain"; } catch { /* Unsafe text rejected below. */ }
  }
  throw new BadRequestException("Use a PDF, PNG, JPEG or UTF-8 text/code file.");
}

@Injectable()
export class TeachingSessionMaterialsService {
  constructor(private readonly db: DatabaseService, private readonly context: TeachingSessionContextService,
    private readonly model: TeachingSessionModelService, private readonly artifacts: TeachingSessionArtifactStore) {}

  async omitted(school: string, session: string, key: string, type: string, name: string) {
    if (!selectedSimulationResources()) return false;
    return (await this.artifacts.read(school,session,key,type,name)).source_content_omitted;
  }

  async add(user: AuthUser, id: string, date: string, raw: unknown) {
    const data = sessionMaterial.parse(raw);
    return this.store(user,id,date,data,null);
  }
  async upload(user: AuthUser, id: string, date: string, raw: unknown, upload: SessionUpload) {
    const data = sessionFile.parse(raw), type = teachingMaterialType(upload);
    return this.store(user,id,date,data,{ upload, type, hash: createHash("sha256").update(upload.data).digest("hex"),
      name: basename(upload.filename).replace(/[\r\n\0]/gu,"_").slice(0,200) || "attachment" });
  }
  private async store(user: AuthUser, id: string, date: string,
    data: ReturnType<typeof sessionMaterial.parse> | ReturnType<typeof sessionFile.parse>,
    file: { upload: SessionUpload; type: string; hash: string; name: string } | null) {
    const result = await this.db.transaction().execute(async tx => {
      if (!user.active_school_id) throw new ForbiddenException("Choose an active campus.");
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${user.active_school_id}`},0))`.execute(tx);
      const access = await this.context.resolve(tx,user,id,date,true), source = access.source;
      const current = await this.model.lock(tx,source.school_id,source.id), revision = current?.revision ?? 0;
      const commitment = { id, date, ...data, ...(file ? { filename: file.name, content_type: file.type, size_bytes: file.upload.data.length, sha256: file.hash } : {}) };
      const prepared = await this.model.prepare(tx,user,access,file ? "material.upload" : "material.add",data,commitment,revision);
      if (prepared.status === "refused") return prepared;
      if (prepared.status === "completed") return { ...prepared.metadata, replayed: true };
      if (!access.can_manage) throw new ForbiddenException("This session is cancelled or outside your current teaching responsibility.");
      const count = await tx.selectFrom("teaching_session_materials").select(tx.fn.countAll<number>().as("count")).where("school_id","=",source.school_id)
        .where("session_id","=",id).executeTakeFirstOrThrow();
      if (Number(count.count) >= 50) throw new BadRequestException("This session has reached its 50-resource version limit. Earlier resources remain available.");
      if (await tx.selectFrom("teaching_session_materials").select("id").where("id","=",data.material_id).executeTakeFirst())
        throw new ConflictException("This resource identity is already used. Reopen the current session.");
      if (data.replaces_material_id && !await tx.selectFrom("teaching_session_materials").select("id").where("school_id","=",source.school_id)
        .where("session_id","=",id).where("id","=",data.replaces_material_id).executeTakeFirst()) throw new BadRequestException("Choose an existing resource from this session to replace.");
      await this.model.ensure(tx,source);
      if (file) await this.artifacts.put(source.school_id,id,data.material_id,file.upload.data,file.type);
      await tx.insertInto("teaching_session_materials").values({ id: data.material_id, school_id: source.school_id, session_id: id,
        title: data.title, kind: file ? "file" : "kind" in data ? data.kind : "text", url: "url" in data ? data.url : "", body: "body" in data ? data.body : "",
        shared: data.shared, replaces_material_id: data.replaces_material_id, storage_key: file ? data.material_id : null,
        original_name: file?.name ?? null, content_type: file?.type ?? null, size_bytes: file?.upload.data.length ?? null,
        sha256: file?.hash ?? null, command_id: prepared.command_id, created_by: user.id, created_at: executionNow() }).execute();
      await tx.updateTable("teaching_sessions").set({ revision: revision+1, source_fingerprint: source.source_fingerprint,
        source_evidence: JSON.stringify(source.source_evidence), updated_at: executionNow() }).where("school_id","=",source.school_id).where("id","=",id).execute();
      const result = { id, date, material_id: data.material_id, revision: revision+1,shared:data.shared };
      await this.model.finish(tx,user,source,prepared.command_id,revision+1,file ? "material.uploaded" : "material.added",result);
      return { ...result, replayed: false };
    });
    if ("status" in result && result.status === "refused") throw new ConflictException(result.error);
    return result;
  }

  async file(user: AuthUser, id: string, date: string, materialId: string) {
    sessionUuid.parse(materialId);
    const access = await this.context.resolve(this.db,user,id,date), source = access.source;
    const record = await this.db.selectFrom("teaching_session_materials").selectAll().where("school_id","=",source.school_id)
      .where("session_id","=",id).where("id","=",materialId).where("kind","=","file").executeTakeFirst();
    if (!record || !record.shared && !access.can_read_preparation) throw new NotFoundException("This class resource is unavailable.");
    const found = await this.artifacts.read(source.school_id,id,record.storage_key!,record.content_type!,record.original_name!);
    if (found.source_content_omitted) return found;
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of found.stream) { const bytes = Buffer.from(chunk); size += bytes.length;
      if (size > 5*1024*1024) throw new ConflictException("The stored resource failed its integrity check."); chunks.push(bytes); }
    const bytes = Buffer.concat(chunks);
    if (size !== record.size_bytes || createHash("sha256").update(bytes).digest("hex") !== record.sha256)
      throw new ConflictException("The stored resource failed its integrity check. Its accepted metadata is retained.");
    return { ...found, stream: Readable.from([bytes]), size_bytes: bytes.length };
  }
}
