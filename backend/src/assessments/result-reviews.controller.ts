import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { ResultReviewsService } from "./result-reviews.service.js";

@Controller("api/v1/schools/:schoolId/assessments/result-reviews")
export class ResultReviewsController {
  constructor(private readonly reviews: ResultReviewsService) {}

  @Get("mine/:assessmentId/:publicationId/")
  learner(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("assessmentId") assessmentId: string,
    @Param("publicationId") publicationId: string, @Query("person_id") personId: unknown, @Query("student_id") studentId: unknown) {
    return this.reviews.learner(request.authUser, schoolId, assessmentId, publicationId, { person_id: personId, student_id: studentId });
  }

  @Post("mine/:assessmentId/:publicationId/")
  submit(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("assessmentId") assessmentId: string,
    @Param("publicationId") publicationId: string, @Body() body: unknown) {
    return this.reviews.submit(request.authUser, schoolId, assessmentId, publicationId, body);
  }

  @Get("workspace/")
  queue(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Query("page") page: unknown) {
    return this.reviews.staffQueue(request.authUser, schoolId, page);
  }

  @Get("receipts/:key/")
  receipt(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("key") key: string) {
    return this.reviews.receipt(request.authUser, schoolId, key);
  }

  @Get(":reviewId/")
  detail(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("reviewId") reviewId: string) {
    return this.reviews.staffDetail(request.authUser, schoolId, reviewId);
  }

  @Post(":reviewId/")
  decide(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("reviewId") reviewId: string, @Body() body: unknown) {
    return this.reviews.decide(request.authUser, schoolId, reviewId, body);
  }
}
