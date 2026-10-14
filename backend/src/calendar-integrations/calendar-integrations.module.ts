import {Module} from '@nestjs/common';
import {AssessmentsModule} from '../assessments/assessments.module.js';
import {CampusEventsModule} from '../campus-events/campus-events.module.js';
import {SchoolModule} from '../school/school.module.js';
import {CalendarIntegrationsController} from './calendar-integrations.controller.js';
import {CalendarIntegrationsService} from './calendar-integrations.service.js';

@Module({imports:[SchoolModule,AssessmentsModule,CampusEventsModule],controllers:[CalendarIntegrationsController],providers:[CalendarIntegrationsService]})
export class CalendarIntegrationsModule{}
