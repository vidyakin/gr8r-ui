/* Демо-данные воркспейса — порт data/seed.js из gr8r-studio.
   Файлы, события и настройки аккаунта пока не перенесены: добавятся вместе со страницами, которым они нужны. */
import { STATUSES } from '../constants';
import { dOff, minsAgo } from './dates';
import type { Activity, CalendarEvent, Comment, LabelId, Member, Notification, Priority, Project, ProjectFile, Status, Subtask, Task, Team, TimeLog, WorkspaceData } from '../domain';

/** Прежние пять уровней приоритета → шкала 1–10 */
const PRIO_SCALE: Record<'urgent' | 'high' | 'medium' | 'low' | 'none', Priority> = { urgent: 10, high: 8, medium: 5, low: 3, none: null };

let aid = 0;
const uid = (p: string) => p + ++aid;

export const TEAMS_SEED: Team[] = [
  { id: 'design', name: 'Design', icon: 'palette', c: '#8662C9', desc: 'Product design, brand, and research' },
  { id: 'eng', name: 'Engineering', icon: 'code', c: '#3B82C4', desc: 'Web, mobile, and platform engineering' },
  { id: 'mkt', name: 'Marketing', icon: 'megaphone', c: '#C54B78', desc: 'Campaigns, content, and growth' },
  { id: 'product', name: 'Product', icon: 'target', c: '#C48A1E', desc: 'Roadmap, planning, and QA' },
];

/** Оценка из старого формата ('3d', '4h', '30m') в часы: день = 8 часов */
const hoursOf = (e: string) => (e.endsWith('d') ? parseFloat(e) * 8 : e.endsWith('m') ? parseFloat(e) / 60 : parseFloat(e));

/** Подзадача для демо-данных: plan — часы (null — сумма вложенных), kids — вложенные подзадачи */
const sub = (id: string, title: string, done = false, plan: number | null = null, kids: Subtask[] = [], extra: Partial<Subtask> = {}): Subtask => ({
  id,
  title,
  done,
  planHours: plan,
  subtasks: kids,
  ...extra,
});

export function seed(): WorkspaceData {
  const members: Member[] = [
    {
      id: 'm1',
      name: 'Tanjim Islam',
      email: 'hello@gr8rstudio.com',
      role: 'Owner',
      team: 'product',
      title: 'Head of Product',
      c: '#5A67D8',
      status: 'active',
      last: 0,
      tz: 'San Francisco',
    },
    {
      id: 'm2',
      name: 'Sarah Chen',
      email: 'sarah@gr8rstudio.com',
      role: 'Admin',
      team: 'design',
      title: 'Design Lead',
      c: '#C54B78',
      status: 'active',
      last: 4,
      tz: 'New York',
    },
    {
      id: 'm3',
      name: 'John Carter',
      email: 'john@gr8rstudio.com',
      role: 'Member',
      team: 'eng',
      title: 'Frontend Engineer',
      c: '#3B82C4',
      status: 'active',
      last: 22,
      tz: 'London',
    },
    {
      id: 'm4',
      name: 'Emma Wilson',
      email: 'emma@gr8rstudio.com',
      role: 'Member',
      team: 'design',
      title: 'Product Designer',
      c: '#23918A',
      status: 'active',
      last: 9,
      tz: 'Berlin',
    },
    {
      id: 'm5',
      name: 'Priya Patel',
      email: 'priya@gr8rstudio.com',
      role: 'Member',
      team: 'mkt',
      title: 'Content Strategist',
      c: '#C48A1E',
      status: 'active',
      last: 95,
      tz: 'Toronto',
    },
    {
      id: 'm6',
      name: 'Marcus Lee',
      email: 'marcus@gr8rstudio.com',
      role: 'Member',
      team: 'eng',
      title: 'Backend Engineer',
      c: '#8662C9',
      status: 'active',
      last: 240,
      tz: 'Singapore',
    },
    {
      id: 'm7',
      name: 'Lena Fischer',
      email: 'lena@gr8rstudio.com',
      role: 'Admin',
      team: 'product',
      title: 'QA Lead',
      c: '#3D8E5F',
      status: 'active',
      last: 1500,
      tz: 'Munich',
    },
    {
      id: 'm8',
      name: 'Diego Alvarez',
      email: 'diego@freelance.io',
      role: 'Guest',
      team: 'mkt',
      title: 'Freelance Copywriter',
      c: '#C0612B',
      status: 'invited',
      last: null,
      tz: 'Madrid',
    },
  ];
  const projects: Project[] = [
    {
      id: 'p1',
      key: 'WEB',
      name: 'Website Redesign',
      module: 'general',
      icon: 'globe',
      color: 'indigo',
      status: 'active',
      team: 'design',
      lead: 'm2',
      due: dOff(24),
      start: dOff(-30),
      fav: true,
      members: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
      desc: 'Rebuild gr8rstudio.com with a clearer information architecture, a responsive component library, and a faster CMS-driven blog.',
      milestones: [
        { name: 'Wireframes signed off', date: dOff(2) },
        { name: 'Dev handoff', date: dOff(14) },
        { name: 'Public launch', date: dOff(24) },
      ],
      last: 12,
    },
    {
      id: 'p2',
      key: 'MOB',
      name: 'Mobile App',
      module: 'general',
      icon: 'smartphone',
      color: 'blue',
      status: 'active',
      team: 'eng',
      lead: 'm3',
      due: dOff(52),
      start: dOff(-45),
      fav: true,
      members: ['m1', 'm3', 'm4', 'm6', 'm7'],
      desc: 'Native iOS and Android client for field teams with offline sync, push notifications, and biometric sign-in.',
      milestones: [
        { name: 'Beta build', date: dOff(9) },
        { name: 'App Store submission', date: dOff(45) },
      ],
      last: 48,
    },
    {
      id: 'p3',
      key: 'MKT',
      name: 'Marketing Campaign',
      module: 'general',
      icon: 'megaphone',
      color: 'rose',
      status: 'planning',
      team: 'mkt',
      lead: 'm5',
      due: dOff(40),
      start: dOff(-10),
      fav: false,
      members: ['m1', 'm4', 'm5', 'm7', 'm8'],
      desc: 'Q4 awareness campaign across paid social, email, and a launch webinar targeting operations leads.',
      milestones: [
        { name: 'Creative lock', date: dOff(12) },
        { name: 'Campaign live', date: dOff(21) },
      ],
      last: 130,
    },
    {
      id: 'p4',
      key: 'LCH',
      name: 'Product Launch',
      module: 'general',
      icon: 'rocket',
      color: 'amber',
      status: 'risk',
      team: 'product',
      lead: 'm1',
      due: dOff(12),
      start: dOff(-21),
      fav: false,
      members: ['m1', 'm2', 'm3', 'm5', 'm7'],
      desc: 'Coordinate the Workflows 2.0 launch: pricing, docs, press, and sales enablement across teams.',
      milestones: [
        { name: 'Go / no-go', date: dOff(11) },
        { name: 'Launch day', date: dOff(12) },
      ],
      last: 35,
    },
    {
      id: 'p5',
      key: 'DS',
      name: 'Design System',
      module: 'general',
      icon: 'component',
      color: 'violet',
      status: 'active',
      team: 'design',
      lead: 'm2',
      due: dOff(70),
      start: dOff(-60),
      fav: false,
      members: ['m2', 'm3', 'm4'],
      desc: 'Shared tokens, components, and documentation used by web and mobile teams.',
      milestones: [{ name: 'v2 tokens', date: dOff(3) }],
      last: 300,
    },
    {
      id: 'p6',
      key: 'CP',
      name: 'Customer Portal',
      module: 'general',
      icon: 'building-2',
      color: 'teal',
      status: 'hold',
      team: 'eng',
      lead: 'm6',
      due: dOff(90),
      start: dOff(-5),
      fav: false,
      members: ['m6', 'm7'],
      private: true,
      desc: 'Self-serve billing and support portal for enterprise customers. Restricted during contract review.',
      milestones: [],
      last: 2880,
    },
    {
      id: 'p7',
      key: 'MW',
      name: 'Marketing Website',
      module: 'general',
      icon: 'layout-grid',
      color: 'green',
      status: 'complete',
      team: 'mkt',
      lead: 'm5',
      due: dOff(-18),
      start: dOff(-80),
      fav: false,
      members: ['m1', 'm3', 'm5'],
      desc: 'Launch site for the spring release. Shipped and handed to the web team for maintenance.',
      milestones: [],
      last: 26000,
    },
  ];
  let n = 0;
  const T: Task[] = [];
  const t = (p: string, title: string, status: Status, a: string | null, prio: 'urgent' | 'high' | 'medium' | 'low' | 'none', due: number | null, labels: LabelId[] = [], x: Partial<Task> & { len?: number; est?: string; age?: number; upd?: number } = {}) => {
    const proj = projects.find(q => q.id === p)!;
    const { len, est, age, upd, ...rest } = x;
    const count = T.filter(q => q.project === p).length + 1;
    T.push(
      Object.assign(
        {
          id: 't' + ++n,
          key: proj.key + '-' + (100 + count * 3),
          project: p,
          module: proj.module,
          title,
          status,
          assignee: a,
          priority: PRIO_SCALE[prio],
          due: due == null ? null : dOff(due),
          start: due == null ? null : dOff(due - (len || 4)),
          labels,
          subtasks: [],
          attachments: [],
          deps: [],
          desc: '',
          planHours: est ? hoursOf(est) : null,
          created: minsAgo(60 * 24 * (age || 12)),
          updated: minsAgo(60 * (upd || 30)),
          order: n,
          fav: false,
          recur: null,
        },
        rest,
      ),
    );
  };
  // Website Redesign
  t('p1', 'Audit existing navigation', 'done', 'm2', 'high', -12, ['research'], { est: '2d', len: 5, age: 28 });
  t('p1', 'Summarize stakeholder interviews', 'done', 'm1', 'medium', -9, ['research'], { est: '1d', age: 26 });
  t('p1', 'Create homepage wireframes', 'review', 'm2', 'high', 1, ['design'], {
    est: '3d',
    len: 7,
    fav: true,
    desc: '<p>Low-fidelity wireframes for the new homepage covering <b>desktop, tablet, and mobile</b> breakpoints.</p><ul><li>Hero with product value proposition</li><li>Customer logos and proof points</li><li>Feature overview linking to product pages</li></ul><p>Reference the navigation audit for IA decisions.</p>',
    subtasks: [
      sub('s1', 'Desktop layout', true, 8),
      sub('s2', 'Tablet layout', true, 5),
      sub('s3', 'Mobile layout', true, 5),
      sub(
        's4',
        'Annotate interactions',
        false,
        null,
        [
          sub('s30', 'Hover & focus states', false, 3, [sub('s31', 'Navigation menu', true, 1.5), sub('s32', 'Buttons & form fields', false, 1.5, [], { assignee: 'm4' })], { assignee: 'm2', due: dOff(1) }),
          sub('s33', 'Scroll & sticky behavior', false, 2),
        ],
        { assignee: 'm2', due: dOff(1), note: 'Annotations go in the Figma file, one frame per breakpoint.' },
      ),
    ],
    attachments: [
      { id: 'a1', name: 'homepage-wireframes-v3.fig', type: 'fig', size: '4.2 MB', by: 'm2', at: minsAgo(300) },
      { id: 'a2', name: 'nav-audit-findings.pdf', type: 'pdf', size: '860 KB', by: 'm2', at: minsAgo(8000) },
    ],
  });
  t('p1', 'Finalize navigation', 'progress', 'm3', 'high', 0, ['design', 'frontend'], {
    est: '2d',
    len: 4,
    subtasks: [
      sub('s5', 'Primary nav structure', true, 6),
      sub('s6', 'Mega-menu content', false, null, [sub('s34', 'Column groupings', true, 3), sub('s35', 'Copy review', false, 2)]),
      sub('s7', 'Mobile drawer behavior', false, 4),
    ],
  });
  t('p1', 'Design responsive navigation', 'progress', 'm4', 'medium', 3, ['design'], {
    est: '3d',
    len: 6,
    subtasks: [sub('s8', 'Breakpoint rules', true, 6), sub('s9', 'Sticky header states', false, 4)],
  });
  t('p1', 'Prepare design system tokens', 'todo', 'm1', 'medium', 6, ['design'], { est: '2d', len: 4 });
  t('p1', 'Review responsive layouts', 'todo', 'm4', 'medium', 8, ['qa', 'design'], { est: '1d', len: 3 });
  t('p1', 'Prepare developer handoff', 'todo', 'm2', 'high', 14, ['frontend'], { est: '2d', len: 4, deps: ['t3', 't5'] });
  t('p1', 'Design mobile onboarding', 'progress', 'm4', 'urgent', -1, ['design'], {
    est: '3d',
    len: 6,
    subtasks: [
      sub('s10', 'Welcome screens', true, 8),
      sub('s11', 'Permission prompts', false, null, [sub('s36', 'Legal review copy', false, 3), sub('s37', 'Fallback states', false, null, [sub('s38', 'Denied', false, 1.5), sub('s39', 'Restricted by parental controls', false, 1.5)])]),
      sub('s12', 'Empty states', false, 4),
    ],
  });
  t('p1', 'Write homepage copy', 'backlog', 'm5', 'low', 18, ['content'], { est: '2d' });
  t('p1', 'Set up analytics events', 'backlog', 'm6', 'medium', 20, ['backend', 'growth'], { est: '1d' });
  t('p1', 'Accessibility audit of templates', 'backlog', 'm7', 'high', 22, ['qa'], { est: '2d' });
  t('p1', 'Build hero component', 'todo', 'm3', 'medium', 10, ['frontend'], { est: '2d', len: 3, deps: ['t3'] });
  t('p1', 'Image optimization pipeline', 'review', 'm6', 'low', 2, ['backend'], { est: '1d', len: 5 });
  t('p1', 'Weekly design sync notes', 'todo', 'm1', 'low', 2, ['content'], { recur: 'Weekly', est: '30m', len: 0 });
  t('p1', 'Migrate blog to new CMS', 'backlog', 'm3', 'medium', 28, ['backend'], { est: '5d', len: 8 });
  t('p1', 'Footer and legal pages', 'done', 'm5', 'low', -5, ['frontend'], { est: '1d' });
  t('p1', 'Fix broken anchor links on pricing', 'done', 'm3', 'medium', -3, ['bug'], { est: '2h', len: 1 });
  // Mobile App
  t('p2', 'Onboarding flow prototype', 'progress', 'm4', 'high', 4, ['design'], { est: '3d', len: 6 });
  t('p2', 'Push notification service', 'progress', 'm6', 'high', 6, ['backend'], { est: '5d', len: 9 });
  t('p2', 'Offline mode sync', 'todo', 'm3', 'urgent', 5, ['frontend', 'backend'], { est: '8d', len: 10, deps: ['t20'] });
  t('p2', 'App Store screenshots', 'backlog', 'm5', 'low', 40, ['content'], { est: '1d' });
  t('p2', 'Crash reporting setup', 'done', 'm6', 'medium', -8, ['backend'], { est: '1d' });
  t('p2', 'Biometric sign-in', 'review', 'm3', 'high', 2, ['frontend'], { est: '3d', len: 6 });
  t('p2', 'Settings screen redesign', 'todo', 'm4', 'medium', 9, ['design'], { est: '2d' });
  t('p2', 'Triage beta tester feedback', 'todo', 'm1', 'medium', 0, ['research'], { est: '4h', len: 1, recur: 'Weekly' });
  t('p2', 'Crash on Android 12 when rotating', 'todo', 'm3', 'urgent', 1, ['bug'], { est: '1d', len: 1 });
  // Marketing Campaign
  t('p3', 'Campaign brief', 'done', 'm5', 'medium', -6, ['content'], { est: '1d' });
  t('p3', 'Landing page copy', 'progress', 'm5', 'medium', 4, ['content'], { est: '2d' });
  t('p3', 'Paid social creatives', 'todo', 'm4', 'high', 7, ['design', 'growth'], { est: '3d', len: 5 });
  t('p3', 'Email nurture sequence', 'todo', 'm8', 'medium', 9, ['content'], { est: '2d' });
  t('p3', 'Influencer outreach list', 'backlog', 'm7', 'low', null, ['growth']);
  t('p3', 'Launch webinar deck', 'todo', 'm1', 'medium', 15, ['content'], { est: '2d' });
  t('p3', 'Budget approval', 'review', 'm1', 'urgent', -2, [], { est: '1h', len: 1 });
  // Product Launch
  t('p4', 'Launch readiness checklist', 'progress', 'm1', 'urgent', 3, ['qa'], {
    est: '1d',
    len: 10,
    subtasks: [
      sub('s20', 'Docs published', true, 2),
      sub('s21', 'Pricing live', false, 1),
      sub('s22', 'Support trained', false, null, [sub('s40', 'Sales team walkthrough', false, 1), sub('s41', 'Support playbook', false, 2)]),
      sub('s23', 'Status page updated', true, 0.5),
    ],
  });
  t('p4', 'Pricing page update', 'todo', 'm2', 'high', 6, ['design', 'frontend'], { est: '2d' });
  t('p4', 'Press release draft', 'review', 'm5', 'medium', 1, ['content'], { est: '1d' });
  t('p4', 'Sales enablement docs', 'todo', 'm7', 'medium', 8, ['content'], { est: '2d' });
  t('p4', 'Release notes', 'backlog', 'm3', 'low', 11, ['content'], { est: '4h' });
  t('p4', 'Go / no-go meeting', 'todo', 'm1', 'high', 11, [], { est: '1h', len: 0 });
  // Design System
  t('p5', 'Color tokens v2', 'done', 'm2', 'high', -4, ['design'], { est: '3d' });
  t('p5', 'Button component audit', 'progress', 'm2', 'medium', 5, ['design', 'frontend'], { est: '2d' });
  t('p5', 'Form field states', 'todo', 'm4', 'medium', 12, ['design'], { est: '3d' });
  t('p5', 'Icon library cleanup', 'backlog', 'm4', 'low', null, ['design']);
  t('p5', 'Documentation site', 'todo', 'm3', 'medium', 20, ['frontend'], { est: '5d', len: 8 });
  t('p5', 'Dark mode palette', 'review', 'm2', 'high', 2, ['design'], { est: '2d' });
  // Marketing Website (complete)
  t('p7', 'Launch site QA', 'done', 'm3', 'high', -20, ['qa']);
  t('p7', 'Spring release hero video', 'done', 'm5', 'medium', -24, ['content']);
  // Customer portal (restricted)
  t('p6', 'Billing API contract', 'todo', 'm6', 'high', 30, ['backend']);

  const tk = (id: string) => T.find(x => x.id === id)!;
  // completed metadata
  T.filter(x => x.status === 'done').forEach((x, i) => (x.completedAt = minsAgo(60 * (6 + i * 17))));
  const comments: Comment[] = [
    {
      id: 'c1',
      task: 't3',
      by: 'm4',
      at: minsAgo(260),
      text: 'Tablet layout feels crowded around the logo strip. Could we drop to four logos under 1024px?',
      re: { '👍': ['m2', 'm3'] },
    },
    { id: 'c2', task: 't3', by: 'm2', at: minsAgo(210), text: 'Good call. Updated in v3 — @Tanjim Islam can you review before Thursday?', re: {} },
    {
      id: 'c3',
      task: 't3',
      by: 'm3',
      at: minsAgo(95),
      text: 'Hero spacing maps cleanly to our 8pt scale. No blockers from engineering.',
      re: { '🎉': ['m2'] },
    },
    { id: 'c4', task: 't4', by: 'm3', at: minsAgo(400), text: "Mega-menu content still pending from marketing. I'll stub it for now.", re: {} },
    { id: 'c5', task: 't4', by: 'm5', at: minsAgo(120), text: '@John Carter content is in the shared doc now — six columns max.', re: { '👍': ['m3'] } },
    { id: 'c6', task: 't9', by: 'm1', at: minsAgo(55), text: 'This slipped past yesterday — @Emma Wilson anything blocking the permission prompts?', re: {} },
    { id: 'c7', task: 't24', by: 'm7', at: minsAgo(700), text: 'Face ID fallback to passcode works on iOS 17; testing Android next.', re: {} },
    { id: 'c8', task: 't34', by: 'm2', at: minsAgo(1500), text: 'Finance needs the channel split before approving.', re: {} },
    { id: 'c9', task: 't35', by: 'm7', at: minsAgo(200), text: 'Support training moved to Monday. @Tanjim Islam please confirm the status page copy.', re: {} },
  ];
  const A = (by: string, verb: string, task: string | null, project: string, m: number, extra = ''): Activity => ({ id: uid('a'), by, verb, task, project, at: minsAgo(m), extra });
  const activity: Activity[] = [
    A('m2', 'moved', 't3', 'p1', 38, 'to Review'),
    A('m3', 'completed', 't18', 'p1', 90),
    A('m4', 'commented on', 't19', 'p2', 140),
    A('m1', 'changed priority of', 't9', 'p1', 180, 'to 10'),
    A('m6', 'added a file to', 't14', 'p1', 260),
    A('m5', 'created', 't30', 'p3', 330),
    A('m2', 'assigned', 't8', 'p1', 420, 'to Sarah Chen'),
    A('m7', 'completed', 't23', 'p2', 1300),
    A('m3', 'moved', 't24', 'p2', 1500, 'to Review'),
    A('m1', 'created project', null, 'p4', 30000),
    A('m2', 'created project', null, 'p1', 43000),
    A('m4', 'completed', 't41', 'p5', 5600),
    A('m5', 'completed', 't17', 'p1', 7200),
  ];
  const notifs: Notification[] = [
    {
      id: 'n1',
      type: 'mention',
      by: 'm2',
      task: 't3',
      text: 'mentioned you in',
      snippet: 'Updated in v3 — @Tanjim Islam can you review before Thursday?',
      at: minsAgo(210),
      read: false,
    },
    { id: 'n2', type: 'assign', by: 'm3', task: 't28', text: 'assigned you', snippet: 'Due today · Priority 5', at: minsAgo(300), read: false },
    {
      id: 'n3',
      type: 'comment',
      by: 'm4',
      task: 't9',
      text: 'commented on',
      snippet: 'Permission prompts need legal review — drafting now.',
      at: minsAgo(40),
      read: false,
    },
    {
      id: 'n4',
      type: 'mention',
      by: 'm7',
      task: 't35',
      text: 'mentioned you in',
      snippet: 'Support training moved to Monday. @Tanjim Islam please confirm the status page copy.',
      at: minsAgo(200),
      read: false,
    },
    { id: 'n5', type: 'update', by: 'm2', task: 't3', text: 'moved to Review', snippet: 'To Do → Review', at: minsAgo(38), read: true },
    {
      id: 'n6',
      type: 'update',
      by: null,
      project: 'p4',
      text: 'Product Launch is at risk',
      snippet: '3 tasks due this week are not started',
      at: minsAgo(600),
      read: false,
    },
    {
      id: 'n7',
      type: 'comment',
      by: 'm2',
      task: 't34',
      text: 'commented on',
      snippet: 'Finance needs the channel split before approving.',
      at: minsAgo(1500),
      read: true,
    },
    { id: 'n8', type: 'assign', by: 'm2', task: 't6', text: 'assigned you', snippet: 'Due in 6 days', at: minsAgo(2900), read: true },
    { id: 'n9', type: 'update', by: 'm3', task: 't18', text: 'completed', snippet: 'Fix broken anchor links on pricing', at: minsAgo(90), read: true },
    { id: 'n10', type: 'update', by: null, task: 't28', text: 'is due today', snippet: 'Triage beta tester feedback', at: minsAgo(20), read: false },
  ];
  const events: CalendarEvent[] = [
    { id: 'e1', title: 'Design review', date: dOff(1), time: '10:00', project: 'p1' },
    { id: 'e2', title: 'Sprint planning', date: dOff(5), time: '09:30', project: 'p2' },
    { id: 'e3', title: 'Launch sync', date: dOff(0), time: '15:00', project: 'p4' },
    { id: 'e4', title: 'Stakeholder demo', date: dOff(9), time: '14:00', project: 'p1' },
    { id: 'e5', title: 'Campaign kickoff', date: dOff(-3), time: '11:00', project: 'p3' },
    { id: 'e6', title: 'Retro', date: dOff(12), time: '16:00', project: 'p2' },
  ];
  const files: ProjectFile[] = [
    { id: 'f1', project: 'p1', name: 'homepage-wireframes-v3.fig', type: 'fig', size: '4.2 MB', by: 'm2', at: minsAgo(300), task: 't3' },
    { id: 'f2', project: 'p1', name: 'nav-audit-findings.pdf', type: 'pdf', size: '860 KB', by: 'm2', at: minsAgo(8000), task: 't3' },
    { id: 'f3', project: 'p1', name: 'brand-photography-set.zip', type: 'zip', size: '128 MB', by: 'm4', at: minsAgo(3000) },
    { id: 'f4', project: 'p1', name: 'hero-exploration.png', type: 'img', size: '2.1 MB', by: 'm4', at: minsAgo(1400) },
    { id: 'f5', project: 'p1', name: 'content-inventory.xlsx', type: 'sheet', size: '310 KB', by: 'm5', at: minsAgo(9000) },
    { id: 'f6', project: 'p1', name: 'sitemap-v2.pdf', type: 'pdf', size: '540 KB', by: 'm1', at: minsAgo(12000) },
    { id: 'f7', project: 'p1', name: 'interview-notes.docx', type: 'doc', size: '96 KB', by: 'm1', at: minsAgo(20000) },
    { id: 'f8', project: 'p1', name: 'analytics-events.json', type: 'code', size: '12 KB', by: 'm6', at: minsAgo(700) },
    { id: 'f9', project: 'p2', name: 'onboarding-flow.fig', type: 'fig', size: '6.8 MB', by: 'm4', at: minsAgo(500) },
    { id: 'f10', project: 'p2', name: 'beta-feedback.xlsx', type: 'sheet', size: '220 KB', by: 'm1', at: minsAgo(900) },
    { id: 'f11', project: 'p3', name: 'campaign-brief.pdf', type: 'pdf', size: '1.1 MB', by: 'm5', at: minsAgo(4000) },
    { id: 'f12', project: 'p4', name: 'launch-plan.docx', type: 'doc', size: '180 KB', by: 'm1', at: minsAgo(6000) },
  ];
  // Учёт времени: часть задач в плане, у двух (wireframes, mobile onboarding) — перерасход
  const byTitle = (title: string) => T.find(x => x.title === title)!.id;
  const timeLogs: TimeLog[] = [];
  const L = (title: string, sb: string | null, by: string, hours: number, daysAgo: number, note = '') =>
    timeLogs.push({ id: 'l' + (timeLogs.length + 1), task: byTitle(title), ...(sb ? { sub: sb } : null), by, hours, date: dOff(-daysAgo), note });
  const WF = 'Create homepage wireframes';
  L(WF, 's1', 'm2', 6.5, 19, 'First pass of the desktop layout');
  L(WF, 's1', 'm2', 2.5, 16, 'Revisions after the design review');
  L(WF, 's2', 'm2', 5, 14);
  L(WF, 's3', 'm2', 4.5, 12, 'Mobile breakpoints');
  L(WF, null, 'm2', 3, 8, 'Stakeholder walkthrough');
  L(WF, null, 'm3', 2, 6, 'Feasibility review with engineering');
  L(WF, null, 'm4', 1.5, 5, 'Tablet feedback');
  L(WF, 's31', 'm2', 1.5, 3, 'Nav hover states');
  L(WF, 's33', 'm2', 1, 2);
  L(WF, null, 'm2', 2, 1, 'v3 updates');
  L('Audit existing navigation', null, 'm2', 6, 27, 'Crawled every top-level page');
  L('Audit existing navigation', null, 'm2', 5, 26);
  L('Audit existing navigation', null, 'm2', 4.5, 25, 'Findings write-up');
  L('Summarize stakeholder interviews', null, 'm1', 3, 24);
  L('Summarize stakeholder interviews', null, 'm1', 3.5, 23, 'Themes and quotes');
  L('Finalize navigation', 's5', 'm3', 5, 5);
  L('Finalize navigation', 's5', 'm3', 2, 4);
  L('Finalize navigation', null, 'm5', 1, 3, 'Content check');
  L('Finalize navigation', 's34', 'm3', 2.5, 2);
  L('Finalize navigation', null, 'm3', 3, 1, 'Mega-menu prototype');
  L('Design responsive navigation', 's8', 'm4', 4, 4);
  L('Design responsive navigation', 's8', 'm4', 3, 3);
  L('Design responsive navigation', null, 'm4', 1, 2);
  L('Design responsive navigation', 's9', 'm4', 2.5, 1);
  const MO = 'Design mobile onboarding';
  L(MO, 's10', 'm4', 7, 10);
  L(MO, 's10', 'm4', 3.5, 9, 'Illustrations');
  L(MO, null, 'm4', 6, 8, 'Prototype in Figma');
  L(MO, 's36', 'm4', 3, 6, 'Rewrote after legal comments');
  L(MO, 's38', 'm4', 2, 5);
  L(MO, null, 'm4', 5, 4, 'Interaction polish');
  L(MO, null, 'm1', 1, 2, 'Review');
  L('Prepare design system tokens', null, 'm1', 2, 1);
  L('Build hero component', null, 'm3', 4, 2);
  L('Build hero component', null, 'm3', 2.5, 1, 'Responsive image handling');
  L('Image optimization pipeline', null, 'm6', 5, 3);
  L('Image optimization pipeline', null, 'm6', 2, 1, 'Benchmarks');
  L('Footer and legal pages', null, 'm5', 7.5, 6);
  L('Fix broken anchor links on pricing', null, 'm3', 2.5, 3, 'Also fixed two redirects');
  L('Onboarding flow prototype', null, 'm4', 8, 3);
  L('Onboarding flow prototype', null, 'm4', 6.5, 2);
  L('Onboarding flow prototype', null, 'm4', 4, 1);
  L('Push notification service', null, 'm6', 8, 4);
  L('Push notification service', null, 'm6', 8, 3, 'APNs integration');
  L('Push notification service', null, 'm6', 6, 2);
  L('Push notification service', null, 'm6', 5.5, 1);
  L('Biometric sign-in', null, 'm3', 7, 6);
  L('Biometric sign-in', null, 'm3', 8, 5, 'Face ID and fingerprint');
  L('Biometric sign-in', null, 'm3', 6.5, 2, 'Fallback to passcode');
  L('Crash reporting setup', null, 'm6', 6, 9);
  L('Offline mode sync', null, 'm3', 8, 1, 'Conflict resolution spike');
  L('Triage beta tester feedback', null, 'm1', 1.5, 7);
  L('Triage beta tester feedback', null, 'm1', 2, 0, 'Weekly triage');
  L('Landing page copy', null, 'm5', 6, 2);
  L('Landing page copy', null, 'm5', 4.5, 1, 'Second draft');
  L('Launch readiness checklist', 's20', 'm1', 1.5, 5);
  L('Launch readiness checklist', 's20', 'm1', 2, 4, 'API reference');
  L('Launch readiness checklist', 's23', 'm1', 0.5, 3);
  L('Launch readiness checklist', null, 'm1', 1, 1, 'Go-live review');
  L('Press release draft', null, 'm5', 5, 2);
  L('Color tokens v2', null, 'm2', 10, 14);
  L('Color tokens v2', null, 'm2', 8, 12);
  L('Color tokens v2', null, 'm2', 7, 10, 'Contrast audit');
  L('Dark mode palette', null, 'm2', 6, 3);
  L('Dark mode palette', null, 'm2', 5, 1, 'Tuning surfaces');
  L('Button component audit', null, 'm2', 3.5, 0);
  const tmp = tk('t3');
  tmp.updated = minsAgo(38);
  return {
    ws: { name: 'FutureERP', url: 'gr8rstudio', c: '#1D1C1A', brand: true },
    me: 'm1',
    members,
    projects,
    tasks: T,
    comments,
    activity,
    notifs,
    teams: TEAMS_SEED.map(x => ({ ...x })),
    events,
    files,
    timeLogs,
    projOrder: projects.map(p => p.id),
    statuses: STATUSES.map(s => ({ id: s.id, name: s.name, color: `var(--st-${s.id})`, builtin: true })),
    savedViews: [{ id: 'v1', project: 'p1', name: 'High priority', type: 'list', filters: [{ f: 'priority', v: ['10', '8'] }] }],
  };
}
