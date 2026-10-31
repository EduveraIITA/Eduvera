/**
 * Authored, owner-requested Aaranya calendar information. This module is pure:
 * importing it never creates calendar overrides, events, assessments or evidence.
 * An authenticated owning-domain importer must review and publish any records.
 */
export const AARANYA_CALENDAR_PROVENANCE =
  'Fictional Aaranya development calendar; not an official schedule.';

export const AARANYA_CALENDAR_YEAR = Object.freeze({
  fixture: 'aaranya-calendar-2026-27-v1',
  institution_name: 'Aaranya Institute of Technology',
  school_id: '5ee339b2-4900-44cc-b1a9-22717c28ab88',
  starts_on: '2026-07-01',
  ends_on: '2027-06-30',
  time_zone: 'Asia/Kolkata',
  semester_i: Object.freeze({ starts_on: '2026-08-11', ends_on: '2026-12-31' }),
  semester_ii: Object.freeze({ starts_on: '2027-01-04', ends_on: '2027-06-30', remains_inactive: true }),
  boundary_notice_ends_on: '2027-07-02',
});

export const AARANYA_CALENDAR_REFERENCES = Object.freeze([
  Object.freeze({
    key: 'iiita-academic',
    url: 'https://iiita.ac.in/academic-calendar',
    pattern: 'Registration, cohort-specific starts, project and examination periods, review windows and breaks.',
  }),
  Object.freeze({
    key: 'iitgn-academic',
    url: 'https://iitgn.ac.in/academics/calendar/acadcal-2026-27',
    pattern: 'Course adjustment, pre-registration, make-up information, summer activity and convocation.',
  }),
  Object.freeze({
    key: 'iiita-campus-life',
    url: 'https://placements.iiita.ac.in/student_life.html',
    pattern: 'Cultural, technical and sports programmes, research activities and campus clubs.',
  }),
  Object.freeze({
    key: 'iiita-dining',
    url: 'https://www.iiita.ac.in/downloads/tenders/uploads/Tender%20%20Night%20Canten%20BH-1%2C2%2C3%20%26%204%2C%202026324.pdf',
    pattern: 'Campus dining has distinct service locations and operating windows, including overnight provision.',
  }),
]);

// Reference-only: the importer must keep these existing operating overrides and
// must not create another holiday, closure or announcement for the same break.
export const AARANYA_EXISTING_CALENDAR_OVERRIDES = Object.freeze([
  Object.freeze({ starts_on: '2026-11-09', ends_on: '2026-11-11', purpose: 'Retain the existing non-instructional break unchanged.' }),
]);

// Authored links to the retained academic periods, not inferred enrolment or a
// reusable campus rule. The importer resolves these keys to the exact terms whose
// dates match AARANYA_CALENDAR_YEAR, and must fail if those source facts differ.
const academicTermLinks = Object.freeze({
  'semester-i-opens': 'semester_i',
  'semester-i-mid-assessment-period': 'semester_i',
  'mid-assessment-review-information': 'semester_i',
  'course-feedback-window': 'semester_i',
  'project-review-preparation': 'semester_i',
  'semester-i-teaching-phase-ends': 'semester_i',
  'semester-i-project-review-period': 'semester_i',
  'semester-i-final-assessment-period': 'semester_i',
  'final-script-review-guidance': 'semester_i',
  'semester-i-result-information': 'semester_i',
  'semester-i-boundary': 'semester_i',
  'semester-ii-opens': 'semester_ii',
  'semester-ii-course-adjustment-information': 'semester_ii',
  'semester-ii-mid-assessment-period': 'semester_ii',
  'semester-ii-teaching-phase-ends': 'semester_ii',
  'semester-ii-final-assessment-period': 'semester_ii',
  'make-up-assessment-information': 'semester_ii',
  'semester-ii-result-information': 'semester_ii',
  'summer-project-review-information': 'semester_ii',
});

function notice(key, startsOn, endsOn, title, detail, category = 'Academic', source = 'iiita-academic') {
  return Object.freeze({
    fixture_key: `aaranya-2026-27-${key}`,
    title,
    description: `${AARANYA_CALENDAR_PROVENANCE} ${detail}`,
    starts_on: startsOn,
    ends_on: endsOn,
    category,
    source_pattern: source,
    ...(academicTermLinks[key] ? { academic_term_key: academicTermLinks[key] } : {}),
  });
}

export const AARANYA_CALENDAR_ARRANGEMENTS = Object.freeze([
  // July: preparation and induction, not an early start to the existing term.
  notice('programme-information', '2026-07-06', '2026-07-10', 'Programme and course information week',
    'Explore programme outlines, course choices and study expectations. Contact the programme coordinator with questions before Semester I teaching begins on 11 August.'),
  notice('incoming-registration-guidance', '2026-07-13', '2026-07-17', 'Incoming cohort registration guidance',
    'Ask the admissions team for the incoming-cohort document checklist, reporting instructions and registration help. Check your application for any individual follow-up.'),
  notice('campus-services-induction', '2026-07-20', '2026-07-24', 'Campus services induction week',
    'Get to know the library, residences, accessibility support and campus help desks. Contact the relevant service team for induction details and accessibility requests.', 'Campus life', 'iiita-campus-life'),
  notice('learner-preparation', '2026-07-27', '2026-07-31', 'Getting ready for postgraduate study',
    'Use this optional preparation week to refresh study skills, review programme reading suggestions and note questions for your academic adviser. Teaching begins on 11 August.', 'Campus life', 'iiita-campus-life'),

  notice('cohort-reporting-orientation', '2026-08-03', '2026-08-07', 'New cohort reporting and orientation information',
    'Check your admission instructions for where to report, what to bring and whom to contact. Ask the admissions team about orientation arrangements before teaching begins on 11 August.'),
  notice('semester-i-opens', '2026-08-11', '2026-08-11', 'Semester I teaching begins',
    'Semester I begins on 11 August. Open Timetable for your classes, rooms and preparation; contact your programme coordinator if your schedule needs attention.'),
  notice('library-laboratory-induction', '2026-08-12', '2026-08-14', 'Library and laboratory induction information',
    'Contact the library and laboratory teams for induction arrangements, borrowing guidance and safe-use instructions. Ask about any preparation needed before your first visit.', 'Campus life', 'iiita-campus-life'),
  notice('course-adjustment-information', '2026-08-21', '2026-08-21', 'Course adjustment information deadline',
    'Planned last day for course-adjustment guidance. Discuss course options with your academic adviser and ask the programme office how to submit a change request.', 'Academic', 'iitgn-academic'),

  notice('mentoring-study-information', '2026-09-05', '2026-09-05', 'Mentoring and study support introduction',
    'Find out how to reach your mentor and study-support team. Contact your programme coordinator if you need help arranging a conversation or finding the right support.', 'Campus life', 'iiita-campus-life'),
  notice('alumni-industry-weekend', '2026-09-12', '2026-09-13', 'Alumni and industry connections weekend',
    'A planned weekend of alumni and industry conversations. Look for published event details and contact the careers team about participation and accessibility.', 'Campus life', 'iiita-campus-life'),
  notice('semester-i-mid-assessment-period', '2026-09-21', '2026-09-25', 'Semester I mid-semester assessment period',
    'Planned mid-semester assessment window. Open Assessments for your applicable subjects, confirmed times and instructions; contact the course examiner with questions.'),
  notice('mid-assessment-review-information', '2026-09-28', '2026-09-30', 'Mid-semester answer-script review information',
    'Ask your course examiner how to request an answer-script review after the mid-semester assessments. Follow the subject-specific review instructions when they are shared.'),

  notice('october-observance-information', '2026-10-02', '2026-10-02', '2 October campus observance information',
    'Campus observance information for 2 October. Check Timetable for teaching arrangements and the relevant service page before planning a visit.'),
  notice('course-feedback-window', '2026-10-16', '2026-10-23', 'Course feedback information window',
    'Planned window for course-feedback guidance. Ask your programme coordinator where to share feedback and how to raise a concern that needs a personal response.'),
  notice('cultural-festival-information', '2026-10-23', '2026-10-25', 'Aaranya cultural festival information',
    'A planned weekend of cultural activities. Open Events for published programmes, venues, entry arrangements and the latest changes.', 'Campus life', 'iiita-campus-life'),
  notice('research-innovation-week', '2026-10-28', '2026-10-30', 'Research and innovation week',
    'Explore research talks and innovation activities, including the 28 October digital-twins colloquium. Open each published Event for its venue, participation details and updates.', 'Campus life', 'iiita-campus-life'),

  // November deliberately contains more than one list page of distinct notices.
  notice('examination-support-information', '2026-11-02', '2026-11-06', 'Examination support information week',
    'Contact the examination team for help with assessment instructions or accessible arrangements. Raise individual support needs early so the relevant team can advise you.'),
  notice('sports-participation-information', '2026-11-08', '2026-11-08', 'Sports weekend participation information',
    'Find out how to take part in the planned sports weekend. Contact the sports coordinator for activity options, entry guidance and accessibility questions.', 'Campus life', 'iiita-campus-life'),
  notice('sports-help-desk-information', '2026-11-12', '2026-11-13', 'Sports weekend help and reporting information',
    'Check the sports coordinator’s latest instructions after the 9–11 November teaching break. Use Events for activity details and Timetable for any assigned duties.', 'Campus life', 'iiita-campus-life'),
  notice('elective-information-window', '2026-11-12', '2026-11-20', 'Next-period elective information window',
    'Explore next-period elective options and discuss your study plan with your academic adviser. Check the published electives questions-and-answers Event for participation details.'),
  notice('sports-residence-weekend', '2026-11-14', '2026-11-15', 'Campus sports and residence weekend',
    'Planned sports and residence-community activities. Open Events for the sports-weekend opening and activity updates; check Dining for date-specific meal changes.', 'Campus life', 'iiita-campus-life'),
  notice('project-review-preparation', '2026-11-16', '2026-11-18', 'Project review preparation information',
    'Prepare your project summary, demonstration and questions for the review. Ask your project supervisor about the applicable brief, assessment criteria and submission instructions.'),
  notice('semester-i-teaching-phase-ends', '2026-11-20', '2026-11-20', 'Semester I scheduled teaching phase ends',
    'The planned regular teaching phase ends on 20 November. Check Assessments for review activity and Timetable for any additional sessions. Semester I continues through 31 December 2026.'),
  notice('semester-i-project-review-period', '2026-11-23', '2026-11-24', 'Semester I project evaluation period',
    'Planned Semester I project-evaluation window. Check your assessment instructions and contact your project supervisor for the applicable review time and preparation.'),
  notice('semester-i-final-assessment-period', '2026-11-25', '2026-12-04', 'Semester I final assessment period',
    'Planned final-assessment window from 25 November to 4 December. Open Assessments for your applicable papers, confirmed times and instructions; direct scheduling questions to the examination team.'),
  notice('assessment-period-dining-guidance', '2026-11-30', '2026-12-04', 'Dining guidance during final assessments',
    'Check Dining before travelling to a meal service during assessments. Look for the current location, planned serving window and any date-specific changes.', 'Service notice', 'iiita-dining'),

  notice('winter-teaching-break-guidance', '2026-12-05', '2027-01-03', 'Winter teaching break information',
    'Planned winter teaching break from 5 December to 3 January. Research and campus services may continue; check published Events, Dining and residence guidance when planning your time on campus.'),
  notice('final-script-review-guidance', '2026-12-08', '2026-12-10', 'Final answer-script review guidance',
    'Planned window for final answer-script review guidance. Contact your course examiner for the subject’s review process and any appointment instructions.'),
  notice('semester-i-result-information', '2026-12-17', '2026-12-17', 'Planned Semester I results information',
    'Planned point for Semester I results updates. See Reports when results are released; contact the examination team if you need help understanding a published result.'),
  notice('semester-ii-registration-guidance', '2026-12-18', '2026-12-30', 'Semester II registration information window',
    'Review planned Semester II registration guidance ahead of the 4 January opening. Contact the programme office for the applicable steps and ask your adviser about course choices.'),
  notice('semester-i-boundary', '2026-12-31', '2026-12-31', 'Semester I academic term ends',
    'Semester I ends on 31 December. Review any outstanding academic questions with the responsible team and check the planned Semester II opening information.'),

  notice('semester-ii-opens', '2027-01-04', '2027-01-04', 'Semester II opening information',
    'Semester II is planned to begin on 4 January. Check the programme office’s opening guidance and your published Timetable when the new term is ready.'),
  notice('semester-ii-course-adjustment-information', '2027-01-04', '2027-01-15', 'Semester II course adjustment information',
    'Planned course-adjustment guidance for Semester II. Discuss your options with your academic adviser and ask the programme office about the applicable request process.', 'Academic', 'iitgn-academic'),
  notice('career-opportunities-briefing', '2027-01-22', '2027-01-22', 'Internship and career opportunities briefing',
    'A planned introduction to internship and career opportunities. Contact the careers team for published opportunities, eligibility information and application guidance.', 'Campus life', 'iiita-campus-life'),
  notice('republic-day-information', '2027-01-26', '2027-01-26', 'Republic Day campus observance information',
    'Campus observance information for Republic Day. Check published programme details, Timetable and the relevant service page for the day’s arrangements.'),

  notice('technical-festival-information', '2027-02-12', '2027-02-14', 'Aaranya technical festival information',
    'Planned technical activities, demonstrations and project conversations. Open Events for published programmes and entry details, and check Dining for the 13 February dinner update.', 'Campus life', 'iiita-campus-life'),
  notice('assessment-service-contacts', '2027-02-19', '2027-02-21', 'Assessment-period service and support contacts',
    'Find current library, study-support and dining contacts before the planned assessment period. Check each service’s published arrangements before visiting.', 'Service notice', 'iiita-dining'),
  notice('semester-ii-mid-assessment-period', '2027-02-22', '2027-02-26', 'Planned Semester II mid-semester assessment period',
    'Planned Semester II mid-semester assessment window. Look for applicable subject schedules in Assessments when published and contact the examination team about preparation or support.'),
  notice('innovation-weekend-boundary', '2027-02-28', '2027-03-01', 'Innovation weekend and project conversations',
    'Planned innovation activities and project conversations across the month boundary. Open published Events for session details and contact the programme coordinators about participation.', 'Campus life', 'iiita-campus-life'),

  notice('visiting-research-programme', '2027-03-05', '2027-03-05', 'Visiting research programme: trustworthy intelligent systems, accessible technology and responsible campus innovation',
    'Planned research conversations on trustworthy intelligent systems, accessible technology and responsible campus innovation. Look for the published programme and contact the research coordinator with participation questions.', 'Campus life', 'iiita-campus-life'),
  notice('spring-teaching-recess-guidance', '2027-03-15', '2027-03-19', 'Scheduled teaching recess information',
    'Planned teaching recess from 15 to 19 March. Check Timetable for your teaching arrangements and the relevant service pages for any planned campus visits.'),
  notice('recess-service-information', '2027-03-22', '2027-03-22', 'Campus support services after the recess',
    'Check current library, study-support, residence and dining arrangements after the planned recess. Contact the relevant service team if you need help planning a visit.', 'Service notice', 'iiita-dining'),
  notice('next-period-programme-information', '2027-03-29', '2027-04-02', 'Next-period programme information week',
    'Explore programme information for the next academic period. Discuss study options with your academic adviser and ask the programme office when course details will be available.', 'Academic', 'iitgn-academic'),

  notice('academic-pre-registration-information', '2027-04-05', '2027-04-09', 'Academic pre-registration information window',
    'Planned pre-registration guidance for the following academic period. Contact the programme office for the applicable process and consult your adviser before choosing courses.', 'Academic', 'iitgn-academic'),
  notice('capstone-exhibition-information', '2027-04-16', '2027-04-16', 'Capstone project exhibition information',
    'A planned showcase of capstone project work. Look for published exhibition details and ask the project coordinator about demonstrations, visitor arrangements and accessibility.', 'Campus life', 'iiita-campus-life'),
  notice('semester-ii-teaching-phase-ends', '2027-04-23', '2027-04-23', 'Planned Semester II teaching phase ends',
    'The Semester II regular teaching phase is planned to end on 23 April, ahead of final evaluations. Check published assessment guidance; the academic term runs through 30 June.'),
  notice('semester-ii-final-assessment-period', '2027-04-26', '2027-05-05', 'Planned Semester II final assessment period',
    'Planned Semester II final-assessment window from 26 April to 5 May. Open Assessments for applicable subject schedules and instructions when published.'),

  notice('make-up-assessment-information', '2027-05-06', '2027-05-07', 'Make-up assessment information window',
    'Contact the examination team for planned make-up assessment guidance. Ask about the applicable eligibility process and look for any individual scheduling instructions.', 'Academic', 'iitgn-academic'),
  notice('semester-ii-result-information', '2027-05-14', '2027-05-14', 'Planned Semester II results information',
    'Planned point for Semester II results updates. See Reports when results are released; contact the examination team about a published result or review guidance.'),
  notice('summer-project-internship-guidance', '2027-05-17', '2027-05-21', 'Summer project and internship guidance',
    'Explore summer project and internship options with your supervisor or careers team. Ask about application guidance, supervision and any travel or residence arrangements you may need.', 'Campus life', 'iiita-campus-life'),
  notice('summer-residence-dining-guidance', '2027-05-24', '2027-05-28', 'Summer residence and dining information',
    'Contact the residence and dining teams about planned summer arrangements. Check published room and meal-service guidance before making travel plans.', 'Service notice', 'iiita-dining'),

  notice('summer-project-review-information', '2027-06-01', '2027-06-12', 'Summer project review information window',
    'Planned summer project-review window. Ask your supervisor about the applicable review brief, preparation and appointment details.'),
  notice('next-cohort-programme-information', '2027-06-14', '2027-06-18', 'Next-cohort programme information',
    'Explore programme information for the following intake. Contact the admissions team for published course details, application guidance and reporting information.'),
  notice('graduation-document-guidance', '2027-06-21', '2027-06-25', 'Graduation and final-document guidance',
    'Ask the academic office for applicable graduation-document and clearance guidance. Use your individual request to follow any corrections, collection arrangements or remaining questions.'),
  notice('convocation-information', '2027-06-26', '2027-06-26', 'Annual convocation information',
    'Planned annual convocation date. Look for published ceremony guidance and contact the academic office about eligibility, guest arrangements and accessibility.', 'Campus life', 'iitgn-academic'),
  notice('academic-year-handover-information', '2027-06-30', '2027-07-02', 'Academic-year handover and next-session registration guidance',
    'Review next-session registration guidance as the academic year closes. Contact the programme office about the coming period and follow up with the responsible team on any unfinished requests.', 'Academic', 'iitgn-academic'),
]);

// Optional, separate source-owned examples for the parent importer to validate.
// They are not Calendar announcements and are not commands or API request bodies.
export const AARANYA_OPTIONAL_EVENT_CANDIDATES = Object.freeze([
  Object.freeze({
    fixture_key: 'aaranya-calendar-event-reproducibility-clinic-20261106',
    title: 'Research reproducibility clinic',
    description: `${AARANYA_CALENDAR_PROVENANCE} A voluntary development workshop candidate. Source pattern: iiita-campus-life; exact venue, organizer, audience and availability require normal Events validation.`,
    date: '2026-11-06', starts_at_local: '14:00', ends_at_local: '16:00', time_zone: 'Asia/Kolkata',
  }),
  Object.freeze({
    fixture_key: 'aaranya-calendar-event-sports-opening-20261114',
    title: 'Campus sports weekend opening',
    description: `${AARANYA_CALENDAR_PROVENANCE} A voluntary sports programme candidate, not confirmed participation or a teaching override. Source pattern: iiita-campus-life; resolve the canonical venue and authorized organizer before creation.`,
    date: '2026-11-14', starts_at_local: '09:00', ends_at_local: '10:00', time_zone: 'Asia/Kolkata',
  }),
  Object.freeze({
    fixture_key: 'aaranya-calendar-event-elective-questions-20261119',
    title: 'Electives and study planning: questions and answers',
    description: `${AARANYA_CALENDAR_PROVENANCE} A voluntary information session candidate, not a subject change or future-term activation. Source pattern: iiita-academic; current source authority and availability must be checked.`,
    date: '2026-11-19', starts_at_local: '16:00', ends_at_local: '17:00', time_zone: 'Asia/Kolkata',
  }),
  Object.freeze({
    fixture_key: 'aaranya-calendar-event-winter-methods-20261214',
    title: 'Winter research methods workshop',
    description: `${AARANYA_CALENDAR_PROVENANCE} A voluntary workshop candidate during the instructional break; a teaching break does not mean all campus activity stops. Source pattern: iiita-campus-life; normal source publication and audience checks remain required.`,
    date: '2026-12-14', starts_at_local: '10:00', ends_at_local: '12:00', time_zone: 'Asia/Kolkata',
  }),
]);

export const AARANYA_OPTIONAL_ASSESSMENT_CANDIDATES = Object.freeze([
  Object.freeze({
    fixture_key: 'aaranya-calendar-assessment-data-practice-20261107',
    title: 'Data engineering practice: reproducible pipeline review',
    description: `${AARANYA_CALENDAR_PROVENANCE} An online, non-physical assessment candidate with no marks or submission evidence. Source pattern: iiita-academic; the importer must resolve the retained IT502 subject, eligible cohort, current term, author and conflict checks before using it.`,
    date: '2026-11-07', starts_at_local: '10:00', duration_minutes: 60,
    time_zone: 'Asia/Kolkata', subject_code_hint: 'IT502', delivery_hint: 'online',
  }),
  Object.freeze({
    fixture_key: 'aaranya-calendar-assessment-programming-review-20261121',
    title: 'Programming concepts: online review exercise',
    description: `${AARANYA_CALENDAR_PROVENANCE} An online, non-physical assessment candidate, not an existing assignment deadline or examination result. Source pattern: iiita-academic; resolve the actual IT503 subject, eligible cohort and current authority through the owning service before creation.`,
    date: '2026-11-21', starts_at_local: '10:00', duration_minutes: 60,
    time_zone: 'Asia/Kolkata', subject_code_hint: 'IT503', delivery_hint: 'online',
  }),
]);
