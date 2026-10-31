import type { ProductIconIdentity } from './theme-tokens';

/** Presentation only: icon choices never select a route or grant authority. */
export const productIconDefinitions = {
  today: ['CalendarDots', 'today'],
  calendar: ['CalendarBlank', 'calendar'],
  timetable: ['CalendarDots', 'timetable'],
  schedule: ['Clock', 'timetable'],
  schedulePlanning: ['CalendarPlus', 'timetable'],
  teaching: ['ChalkboardTeacher', 'timetable'],
  work: ['Briefcase', 'work'],
  request: ['ChatCenteredText', 'neutral'],
  offer: ['Handshake', 'neutral'],
  task: ['ListChecks', 'neutral'],
  areas: ['GridFour', 'areas'],
  more: ['DotsThreeOutline', 'more'],
  settings: ['SlidersHorizontal', 'neutral'],
  profile: ['UserCircle', 'profile'],
  security: ['ShieldCheck', 'neutral'],
  access: ['Key', 'neutral'],
  verification: ['SealCheck', 'neutral'],
  connections: ['PlugsConnected', 'neutral'],
  capabilities: ['PuzzlePiece', 'neutral'],
  attendance: ['ClipboardText', 'attendance'],
  registers: ['ClipboardText', 'attendance'],
  attendancePatterns: ['ChartLine', 'attendance'],
  attendanceRecords: ['CalendarCheck', 'attendance'],
  attendanceReview: ['UserCheck', 'attendance'],
  leave: ['CalendarX', 'responsibilities'],
  insights: ['ChartBar', 'insights'],
  institutionInsights: ['ChartPieSlice', 'insights'],
  messages: ['ChatsCircle', 'messages'],
  people: ['UsersThree', 'people'],
  person: ['UserCircle', 'people'],
  groups: ['UsersFour', 'people'],
  staff: ['IdentificationBadge', 'people'],
  classes: ['GraduationCap', 'people'],
  enrollment: ['IdentificationCard', 'people'],
  import: ['FileArrowUp', 'people'],
  building: ['Buildings', 'campus'],
  campus: ['MapTrifold', 'campus'],
  gate: ['DoorOpen', 'gate'],
  visits: ['IdentificationCard', 'gate'],
  movements: ['ArrowsLeftRight', 'gate'],
  entryPoints: ['DoorOpen', 'gate'],
  visitorApprovals: ['UserCheck', 'gate'],
  resources: ['Package', 'resources'],
  loans: ['Handshake', 'resources'],
  facilities: ['Wrench', 'facilities'],
  accommodation: ['Bed', 'accommodation'],
  dining: ['ForkKnife', 'dining'],
  diningService: ['Storefront', 'dining'],
  simulation: ['Flask', 'neutral'],
  learning: ['Books', 'learning'],
  assessments: ['Exam', 'assessments'],
  assessmentMarking: ['PencilLine', 'assessments'],
  assessmentPlanning: ['ListChecks', 'assessments'],
  assessmentResults: ['ChartBar', 'assessments'],
  examinations: ['Exam', 'assessments'],
  performance: ['ChartLine', 'assessments'],
  assignments: ['Notebook', 'messages'],
  practice: ['NotePencil', 'messages'],
  reports: ['FileText', 'reports'],
  remarks: ['NotePencil', 'reports'],
  notifications: ['BellRinging', 'notifications'],
  invitations: ['EnvelopeSimple', 'people'],
  fees: ['Wallet', 'fees'],
  finance: ['CreditCard', 'fees'],
  receipts: ['Receipt', 'fees'],
  updates: ['Megaphone', 'messages'],
  events: ['CalendarStar', 'events'],
  eventPlanning: ['CalendarPlus', 'events'],
  responsibilities: ['Flag', 'responsibilities'],
  coverage: ['UserSwitch', 'responsibilities'],
  care: ['HandHeart', 'care'],
  feedback: ['Target', 'neutral'],
  policies: ['FileText', 'neutral'],
  governance: ['Scales', 'neutral'],
  operatingRules: ['SlidersHorizontal', 'neutral'],
  organization: ['TreeStructure', 'neutral'],
  relationships: ['Link', 'people'],
  camera: ['Camera', 'neutral'],
  transport: ['Bus', 'departure'],
  departurePlan: ['Path', 'departure'],
  departurePlanning: ['MapTrifold', 'departure'],
  completed: ['CheckCircle', 'status-positive'],
  records: ['Archive', 'neutral'],
  history: ['ClockCounterClockwise', 'neutral'],
  files: ['Paperclip', 'neutral'],
  assistant: ['Assistant', 'brand'],
  unknown: ['Question', 'neutral'],
 } as const satisfies Record<string, readonly [string, ProductIconIdentity]>;
export type ProductIconName = keyof typeof productIconDefinitions;

const fallbackAliases: Readonly<Record<string, ProductIconName>> = {
  students: 'people', guardians: 'people', parents: 'people', academic: 'learning',
  'in-out': 'gate', departure: 'transport', 'virtual-campus': 'campus',
};
function fallbackIcon(value?: string | null): ProductIconName {
  if (!value) return 'unknown';
  if (Object.hasOwn(productIconDefinitions, value)) return value as ProductIconName;
  return Object.hasOwn(fallbackAliases, value) ? fallbackAliases[value]! : 'unknown';
}

/** Match the destination, never arbitrary search text, person IDs or prose in its query. */
export function iconForDestination(href: string, fallback?: string | null): ProductIconName {
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return fallbackIcon(fallback);
  let url: URL; try { url = new URL(href, 'https://thatcampus.invalid'); } catch { return fallbackIcon(fallback); }
  const path = url.pathname.toLowerCase().replace(/\/+$/, '') || '/', query = url.searchParams;
  const under = (root: string) => path === root || path.startsWith(root + '/');
  if (under('/areas/assistant')) return 'assistant';
  if (under('/areas/attendance')) {
    if (under('/areas/attendance/registers')) return 'registers';
    if (under('/areas/attendance/thresholds') || under('/areas/attendance/follow-ups')) return 'attendancePatterns';
    if (under('/areas/attendance/records') || under('/areas/attendance/evidence')) return 'attendanceRecords';
    if (under('/areas/attendance/leave')) return 'leave';
    if (under('/areas/attendance/coordination')) return 'attendanceReview';
    return 'attendance';
  }
  if (under('/areas/assessments')) {
    if (under('/areas/assessments/results')) return 'assessmentResults';
    if (under('/areas/assessments/assigned')) return 'assessmentMarking';
    if (under('/areas/assessments/manage')) return 'assessmentPlanning';
    return 'assessments';
  }
  if (under('/areas/in-out') || under('/work/in-out')) {
    if (under('/areas/in-out/visits')) return 'visits';
    if (under('/areas/in-out/operate')) return 'movements';
    if (under('/areas/in-out/manage')) return 'entryPoints';
    if (under('/work/in-out/approvals')) return 'visitorApprovals';
    return 'gate';
  }
  if (under('/areas/timetable')) {
    if (under('/areas/timetable/planning')) return 'schedulePlanning';
    if (under('/areas/timetable/session')) return 'teaching';
    return 'timetable';
  }
  if (under('/areas/messages/assignments') || under('/areas/learning/assignments')) return 'assignments';
  if (under('/areas/messages/diary')) return 'practice';
  if (under('/areas/messages/updates')) return 'updates';
  if (under('/areas/messages')) return 'messages';
  if (under('/areas/learning')) return 'learning';
  if (under('/areas/events')) return under('/areas/events/manage') ? 'eventPlanning' : 'events';
  if (under('/areas/calendar')) return 'calendar';
  if (under('/areas/reports')) return under('/areas/reports/remarks') ? 'remarks' : 'reports';
  if (under('/areas/insights')) {
    if (under('/areas/insights/attendance') || under('/areas/insights/thresholds')) return 'attendancePatterns';
    if (under('/areas/insights/registers')) return 'registers';
    if (under('/areas/insights/results')) return 'assessmentResults';
    if (under('/areas/insights/progress')) return 'assessmentPlanning';
    if (under('/areas/insights/finance')) return 'finance';
    return query.get('scope') === 'institution' ? 'institutionInsights' : 'insights';
  }
  if (under('/areas/people')) {
    if (under('/areas/people/classes')) return 'classes';
    if (under('/areas/people/import')) return 'import';
    if (under('/areas/people/records')) return 'enrollment';
    return query.get('view') === 'groups' ? 'groups' : 'people';
  }
  if (under('/areas/responsibilities')) {
    if (under('/areas/responsibilities/coverage')) return 'coverage';
    if (under('/areas/responsibilities/leave')) return 'leave';
    return 'responsibilities';
  }
  if (under('/areas/departure')) {
    if (under('/areas/departure/plan')) return 'departurePlan';
    if (under('/areas/departure/manage')) return 'departurePlanning';
    return 'transport';
  }
  if (under('/areas/resources')) return query.has('loan_id') || query.get('view') === 'mine' || query.get('view') === 'loans' ? 'loans' : 'resources';
  if (under('/areas/facilities')) return 'facilities';
  if (under('/areas/accommodation')) return 'accommodation';
  if (under('/areas/dining')) return query.has('service_id') && !query.has('session_id') || query.get('view') === 'services' ? 'diningService' : 'dining';
  if (under('/areas/fees')) return under('/areas/fees/ledger') ? 'receipts' : 'fees';
  if (under('/areas/finance')) return 'finance';
  if (under('/areas/care')) return 'care';
  if (under('/more/virtual-campus') || under('/more/campus-view')) return 'campus';
  if (under('/more/setup/people/invitations')) return 'invitations';
  if (under('/more/setup/people/access')) return 'access';
  if (under('/more/setup/people')) return query.get('section') === 'invitations' ? 'invitations' : 'people';
  if (under('/more/setup/responsibilities')) return 'responsibilities';
  if (under('/more/setup/organization')) return 'organization';
  if (under('/more/setup/capabilities')) return fallbackIcon(query.get('task') || fallback || 'capabilities');
  if (under('/more/setup/institution')) {
    if (under('/more/setup/institution/operating-rules') || query.get('section') === 'rules') return 'operatingRules';
    if (under('/more/setup/institution/history') || query.get('section') === 'audit') return 'history';
    if (under('/more/setup/institution/academics') || under('/more/setup/institution/promotion') || query.get('section') === 'setup' || query.get('section') === 'promotion') return 'classes';
    return 'building';
  }
  if (under('/more/setup')) return 'settings';
  if (under('/more/account/security') || under('/account/security')) return 'security';
  if (under('/more/account') || under('/account') || under('/profile')) return 'profile';
  if (under('/more/connections')) return 'connections';
  if (under('/more/verification')) return 'verification';
  if (under('/more/simulation')) return 'simulation';
  if (under('/more/notifications')) return 'notifications';
  if (under('/more/policies')) return 'policies';
  if (under('/more/governance')) return 'governance';
  if (under('/more/feedback')) return 'feedback';
  if (path === '/today') return 'today';
  if (path === '/work') return 'work';
  if (path === '/areas') return 'areas';
  if (path === '/more') return 'more';
  if (path === '/visit-join') return 'visits';
  return fallbackIcon(fallback);
}

/** Destination identity is independent of glyph shape. A cross-link adopts its
 * actual destination area; arbitrary query prose cannot recolour the icon. */
export function iconAreaForDestination(href: string, fallback: ProductIconIdentity = 'neutral'): ProductIconIdentity {
  if (!href.startsWith('/') || href.startsWith('//')) return fallback;
  let path: string; try { path = new URL(href, 'https://thatcampus.invalid').pathname.toLowerCase().replace(/\/+$/, ''); } catch { return fallback; }
  const area = path.match(/^\/areas\/([^/]+)(?:\/|$)/)?.[1];
  const areas: Readonly<Record<string, ProductIconIdentity>> = {
    attendance: 'attendance', timetable: 'timetable', calendar: 'calendar',
    'in-out': 'gate', assessments: 'assessments', events: 'events', messages: 'messages',
    departure: 'departure', reports: 'reports', insights: 'insights', people: 'people',
    fees: 'fees', finance: 'fees', resources: 'resources', facilities: 'facilities',
    accommodation: 'accommodation', dining: 'dining', responsibilities: 'responsibilities',
    care: 'care', learning: 'learning', assistant: 'brand',
  };
  if (area && Object.hasOwn(areas, area)) return areas[area]!;
  if (/^\/work\/in-out(?:\/|$)/.test(path) || path === '/visit-join') return 'gate';
  if (/^\/more\/(?:virtual-campus|campus-view)(?:\/|$)/.test(path)) return 'campus';
  return fallback;
}
