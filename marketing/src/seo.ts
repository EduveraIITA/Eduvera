export type SolutionPage = {
  path: string;
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  lead: string;
  proof: string;
  screen: 'overview' | 'attendance' | 'family' | 'planner-desktop';
  screenWidth: number;
  screenHeight: number;
  screenAlt: string;
  outcomes: Array<{ title: string; body: string }>;
  steps: Array<{ title: string; body: string }>;
  questions: Array<{ question: string; answer: string }>;
  related: string[];
};

export const homeMeta = {
  path: '/',
  title: 'ThatCampus | Connected School Operations for Every Role',
  description: 'Connect attendance, timetables, school communication and day-to-day operations in one role-based workspace. Explore the ThatCampus public demo.',
};

export const solutionPages: SolutionPage[] = [
  {
    path: '/school-management-software',
    title: 'School Management Software for Indian Schools | ThatCampus',
    description: 'Bring attendance, timetables, requests, communication and school operations into one role-based system built around the Indian school day.',
    eyebrow: 'School management software',
    heading: 'Run the school day from one connected workspace.',
    lead: 'ThatCampus gives principals, teachers, parents and students a view shaped around their role—while keeping the work connected behind the scenes.',
    proof: 'Real ThatCampus principal workspace using synthetic school data.',
    screen: 'overview', screenWidth: 860, screenHeight: 1800,
    screenAlt: 'ThatCampus school management dashboard showing attendance registers, follow-ups and operational priorities',
    outcomes: [
      { title: 'One source of attention', body: 'Move from a school-level signal to the class, request or learner that needs action.' },
      { title: 'Workspaces for every role', body: 'Give school leaders, teachers and families the information and actions appropriate to them.' },
      { title: 'Rules that fit the institution', body: 'Configure supported operating rules without hiding decisions inside individual screens.' },
    ],
    steps: [
      { title: 'Start with the school day', body: 'Bring attendance, schedules, notices, requests and operational records into a shared system.' },
      { title: 'Connect people to their work', body: 'Roles and permissions determine which records each person can see and what they can do.' },
      { title: 'Follow attention to the source', body: 'High-level indicators lead to the individual item so people can understand and resolve it.' },
    ],
    questions: [
      { question: 'Is ThatCampus an ERP?', answer: 'ThatCampus is a school operations platform. It connects everyday work such as attendance, timetables, communication and requests; available modules and integrations depend on the institution’s setup.' },
      { question: 'Who can use it?', answer: 'The product provides role-based workspaces for principals, staff, parents and students. Institutions control access through memberships and permissions.' },
      { question: 'Can we explore it without an account?', answer: 'Yes. The public demo uses synthetic, read-only sample data and lets you switch between four representative roles.' },
    ],
    related: ['/school-attendance-management', '/school-timetable-software', '/parent-communication-app'],
  },
  {
    path: '/school-attendance-management',
    title: 'School Attendance Management Software | ThatCampus',
    description: 'Manage daily or subject-wise attendance, corrections, follow-ups and configurable register finalisation in one school attendance system.',
    eyebrow: 'Attendance management',
    heading: 'Attendance that matches how your school actually runs.',
    lead: 'Use daily, subject-wise or supported entry-and-exit attendance patterns. Teachers record the register; school leaders see coverage, exceptions and the next action.',
    proof: 'Real period-wise attendance view using synthetic school data.',
    screen: 'attendance', screenWidth: 860, screenHeight: 1800,
    screenAlt: 'ThatCampus school attendance software with registers grouped by period and class',
    outcomes: [
      { title: 'Daily or subject-wise registers', body: 'Choose an attendance model that reflects the institution instead of forcing every campus into one pattern.' },
      { title: 'Clear submission state', body: 'See what is upcoming, open, submitted or overdue without treating future periods as incomplete work.' },
      { title: 'Traceable corrections', body: 'Keep the observation source and revision history attached when an authorised user corrects a record.' },
    ],
    steps: [
      { title: 'Open the right register', body: 'Navigate by period, class, subject or teacher to reach the exact session.' },
      { title: 'Record attendance once', body: 'Mark individuals, use supported bulk actions or review an assisted observation before saving.' },
      { title: 'Resolve what needs attention', body: 'Follow missing registers or learner exceptions to the responsible item and recorded outcome.' },
    ],
    questions: [
      { question: 'Does it support subject-wise attendance?', answer: 'Yes. Registers can be tied to a class, subject and timetable period. Institutions that only need daily attendance can configure that model instead.' },
      { question: 'Can attendance lock automatically?', answer: 'Institutions can configure operating rules for submission and finalisation. Existing records retain the rule snapshot they received.' },
      { question: 'Is camera-assisted attendance automatic?', answer: 'Assisted observations require authorised review before records are saved. The system does not present an unreviewed model result as final attendance.' },
    ],
    related: ['/school-management-software', '/school-timetable-software', '/ai-assistant-for-schools'],
  },
  {
    path: '/school-timetable-software',
    title: 'School Timetable and Calendar Software | ThatCampus',
    description: 'View classes on a real timeline, plan free slots and connect recurring lessons, events and holidays in one school timetable and calendar.',
    eyebrow: 'Timetable and calendar',
    heading: 'See time the way a school day happens.',
    lead: 'ThatCampus places lessons and activities on a timeline based on their actual start time and duration, so teams can understand the day before they edit it.',
    proof: 'Real experimental weekly timeline using synthetic school data.',
    screen: 'planner-desktop', screenWidth: 1920, screenHeight: 1307,
    screenAlt: 'ThatCampus school timetable software with classes positioned on a weekly timeline',
    outcomes: [
      { title: 'One view for seeing and planning', body: 'Open a scheduled item for detail or choose free time to plan, without switching to a separate builder.' },
      { title: 'Time and duration stay visible', body: 'Position and height communicate when something happens and how long it lasts.' },
      { title: 'Recurring and one-time work', body: 'Plan supported repeating classes alongside events, holidays and other calendar items.' },
    ],
    steps: [
      { title: 'Choose the timetable context', body: 'Open the relevant class, teacher or supported campus view.' },
      { title: 'Read the week spatially', body: 'Scan lessons, gaps and overlaps by their place on the timeline.' },
      { title: 'Plan from available time', body: 'Select a free slot, review the details and save the appropriate one-time or recurring item.' },
    ],
    questions: [
      { question: 'Can we plan classes and events together?', answer: 'The calendar direction is designed to show recurring classes, events and holidays in a shared time-based view. Availability depends on the institution’s enabled modules.' },
      { question: 'Can users sync to a personal calendar?', answer: 'ThatCampus supports standards-based calendar export so a user can add relevant calendars to a compatible installed calendar app without a paid provider integration.' },
      { question: 'Is the new timeline the default?', answer: 'The timeline experience is currently available through Experimental settings while it is compared with the established timetable module.' },
    ],
    related: ['/school-management-software', '/school-attendance-management', '/parent-communication-app'],
  },
  {
    path: '/parent-communication-app',
    title: 'School Parent Communication App | ThatCampus',
    description: 'Give families one place for school notices, attendance, schedules, requests and child-specific updates with clear actions and outcomes.',
    eyebrow: 'Parent communication',
    heading: 'Keep families close to the school day.',
    lead: 'Parents see information in the context of their child: today’s lessons, attendance, notices and requests—along with a clear indication when a response is needed.',
    proof: 'Real ThatCampus family workspace using synthetic school data.',
    screen: 'family', screenWidth: 860, screenHeight: 1800,
    screenAlt: 'ThatCampus parent communication app showing a child’s attendance, lessons and school requests',
    outcomes: [
      { title: 'Updates with context', body: 'Connect a notice or request to the relevant learner instead of sending families into a generic inbox.' },
      { title: 'Attention without notification noise', body: 'Use indicators for unresolved work and lead people to the exact item that needs them.' },
      { title: 'One familiar place', body: 'Bring schedules, attendance and school communication together instead of relying on disconnected chats.' },
    ],
    steps: [
      { title: 'Choose the linked child', body: 'Families with more than one learner can keep the active child visible while they navigate.' },
      { title: 'Understand today first', body: 'Start with the current school day, recent updates and actions that remain open.' },
      { title: 'Reach a recorded outcome', body: 'Open the notice, request or attendance detail, respond where required and retain the result.' },
    ],
    questions: [
      { question: 'Can one parent access multiple children?', answer: 'Yes. A guardian can be linked to multiple students, subject to the institution’s verified relationships and access rules.' },
      { question: 'Does every update create a red badge?', answer: 'No. Attention indicators are intended for unread or unresolved items that benefit from action, not simply for old records or all activity.' },
      { question: 'Does this replace every messaging app?', answer: 'ThatCampus provides school-context communication and recorded actions. Institutions can also use supported external chat and calendar connections where configured.' },
    ],
    related: ['/school-management-software', '/school-attendance-management', '/ai-assistant-for-schools'],
  },
  {
    path: '/ai-assistant-for-schools',
    title: 'AI Assistant for School Operations | ThatCampus',
    description: 'See how ThatCampus AI answers school-context questions, shows its sources and prepares supported actions for human review within each user’s access.',
    eyebrow: 'ThatCampus AI',
    heading: 'Ask in context. Keep people in control.',
    lead: 'The assistant works inside the user’s existing access. It can help find school information and prepare supported actions while source checks and required approval remain visible.',
    proof: 'Illustrative ThatCampus AI interactions using synthetic school data. The public demo does not run a model.',
    screen: 'overview', screenWidth: 860, screenHeight: 1800,
    screenAlt: 'ThatCampus school operations workspace connected to an access-aware AI assistant',
    outcomes: [
      { title: 'Answers grounded in school records', body: 'Use the information a signed-in person is already authorised to access.' },
      { title: 'Sources stay visible', body: 'Let the user understand which record supports an answer instead of presenting an unexplained result.' },
      { title: 'Actions remain reviewable', body: 'Prepare a supported action, such as a reminder, without silently sending or changing a school record.' },
    ],
    steps: [
      { title: 'Ask a school-context question', body: 'Start in the assistant or a supported connected chat channel.' },
      { title: 'Review the answer and source', body: 'The response keeps relevant school context and verification close together.' },
      { title: 'Approve supported actions', body: 'Where an action is available, the responsible person reviews it before execution.' },
    ],
    questions: [
      { question: 'Can the assistant see every school record?', answer: 'No. It is designed to work within the signed-in user’s institution, role and permission boundaries.' },
      { question: 'Does the AI act without approval?', answer: 'Supported actions follow the application’s permission and review requirements. The demonstrations show reminders being prepared, not silently sent.' },
      { question: 'Can users talk to it outside the app?', answer: 'The integration architecture supports provider adapters. Telegram is the first supported external chat direction; other providers can be added without changing the core conversation model.' },
    ],
    related: ['/school-management-software', '/school-attendance-management', '/parent-communication-app'],
  },
];

export const solutionByPath = Object.fromEntries(solutionPages.map(page => [page.path, page])) as Record<string, SolutionPage>;
export const publicPaths = ['/', ...solutionPages.map(page => page.path), '/privacy', '/terms'];

export function metaForPath(pathname: string) {
  if (pathname === '/') return homeMeta;
  const solution = solutionByPath[pathname];
  if (solution) return { path: solution.path, title: solution.title, description: solution.description };
  if (pathname === '/privacy') return { path: pathname, title: 'Privacy Policy | ThatCampus', description: 'How ThatCampus handles information submitted through the public website and school platform.' };
  if (pathname === '/terms') return { path: pathname, title: 'Terms of Service | ThatCampus', description: 'Terms governing use of the ThatCampus public website and services.' };
  return homeMeta;
}
