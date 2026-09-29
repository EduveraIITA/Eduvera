import { BadRequestException, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../common/request.js";
import { PhotoAttendanceService, type UploadedPhoto } from "./photo-attendance.service.js";

async function photoAndFields(request: AuthenticatedRequest): Promise<{
  fields: Record<string, string>;
  photo: UploadedPhoto;
}> {
  if (!request.isMultipart()) throw new BadRequestException("Upload a photo using multipart form data.");
  const fields: Record<string, string> = {};
  let photo: UploadedPhoto | undefined;
  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "file") {
        await part.toBuffer();
        throw new BadRequestException("Use the file field for the attendance photo.");
      }
      if (photo) throw new BadRequestException("Upload one photo at a time.");
      photo = { filename: part.filename, mimetype: part.mimetype, data: await part.toBuffer() };
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  if (!photo) throw new BadRequestException("Select a photo to continue.");
  return { fields, photo };
}

@ApiTags("photo attendance")
@ApiCookieAuth()
@Controller("api/v1/photo-attendance")
export class PhotoAttendanceController {
  constructor(private readonly photoAttendance: PhotoAttendanceService) {}

  @Get("classes/:classSectionId/setup/")
  setup(
    @Req() request: AuthenticatedRequest,
    @Param("classSectionId") classSectionId: string,
    @Query("date") date: string,
  ) {
    return this.photoAttendance.setup(request.authUser, classSectionId, date);
  }

  @Post("students/:studentId/samples/")
  async enroll(
    @Req() request: AuthenticatedRequest,
    @Param("studentId") studentId: string,
  ) {
    const { fields, photo } = await photoAndFields(request);
    return this.photoAttendance.enroll(request, studentId, fields, photo);
  }

  @Post("classes/:classSectionId/analyze/")
  async analyze(
    @Req() request: AuthenticatedRequest,
    @Param("classSectionId") classSectionId: string,
  ) {
    const { fields, photo } = await photoAndFields(request);
    return this.photoAttendance.analyze(request, classSectionId, fields, photo);
  }

  @Get("sessions/:sessionId/")
  detail(@Req() request: AuthenticatedRequest, @Param("sessionId") sessionId: string) {
    return this.photoAttendance.detail(request.authUser, sessionId);
  }
}
