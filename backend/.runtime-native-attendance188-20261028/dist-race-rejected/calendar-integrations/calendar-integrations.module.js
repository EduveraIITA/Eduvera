var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { AssessmentsModule } from '../assessments/assessments.module.js';
import { CampusEventsModule } from '../campus-events/campus-events.module.js';
import { SchoolModule } from '../school/school.module.js';
import { CalendarIntegrationsController } from './calendar-integrations.controller.js';
import { CalendarIntegrationsService } from './calendar-integrations.service.js';
let CalendarIntegrationsModule = class CalendarIntegrationsModule {
};
CalendarIntegrationsModule = __decorate([
    Module({ imports: [SchoolModule, AssessmentsModule, CampusEventsModule], controllers: [CalendarIntegrationsController], providers: [CalendarIntegrationsService] })
], CalendarIntegrationsModule);
export { CalendarIntegrationsModule };
//# sourceMappingURL=calendar-integrations.module.js.map