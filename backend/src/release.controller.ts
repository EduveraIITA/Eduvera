import { Controller, Get } from "@nestjs/common";
import { Public } from "./common/decorators.js";
import { config } from "./config.js";

@Controller()
export class ReleaseController {
  @Public()
  @Get("releasez")
  release() {
    return {
      release_sha: config().RELEASE_SHA ?? "development",
      environment: config().DEPLOYMENT_ENVIRONMENT,
    };
  }
}
