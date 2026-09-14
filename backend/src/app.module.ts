import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AiModule } from "./ai/ai.module.js";
import { AppController } from "./app.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { CsrfGuard, SessionGuard } from "./auth/guards.js";
import { ChatModule } from "./chat/chat.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { SchoolModule } from "./school/school.module.js";
import { SpaController } from "./spa.controller.js";

@Module({
  imports: [DatabaseModule, AuthModule, SchoolModule, ChatModule, AiModule],
  controllers: [AppController, SpaController],
  providers: [
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}
