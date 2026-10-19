/* Демо-данные воркспейса — порт data/seed.js из gr8r-studio.
   Комментарии, файлы, события и настройки аккаунта пока не перенесены: добавятся вместе со страницами, которым они нужны. */
import { dOff, minsAgo } from '../lib/dates';
import type { Activity, LabelId, Member, Notification, Priority, Project, Status, Task, Team, WorkspaceData } from './types';

let aid = 0;
const uid = (p: string) => p + ++aid;

export const TEAMS_SEED: Team[] = [
  { id: 'design', name: 'Design', icon: 'palette', c: '#8662C9', desc: 'Product design, brand, and research' },
  { id: 'eng', name: 'Engineering', icon: 'code', c: '#3B82C4', desc: 'Web, mobile, and platform engineering' },
  { id: 'mkt', name: 'Marketing', icon: 'megaphone', c: '#C54B78', desc: 'Campaigns, content, and growth' },
  { id: 'product', name: 'Product', icon: 'target', c: '#C48A1E', desc: 'Roadmap, planning, and QA' },
];

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
  const t = (p: string, title: string, status: Status, a: string | null, prio: Priority, due: number | null, labels: LabelId[] = [], x: Partial<Task> & { len?: number; est?: string; age?: number; upd?: number } = {}) => {
    const proj = projects.find(q => q.id === p)!;
    const { len, est, age, upd, ...rest } = x;
    const count = T.filter(q => q.project === p).length + 1;
    T.push(
      Object.assign(
        {
          id: 't' + ++n,
          key: proj.key + '-' + (100 + count * 3),
          project: p,
          title,
          status,
          assignee: a,
          priority: prio,
          due: due == null ? null : dOff(due),
          start: due == null ? null : dOff(due - (len || 4)),
          labels,
          subtasks: [],
          attachments: [],
          deps: [],
          desc: '',
          estimate: est || null,
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
      { id: 's1', title: 'Desktop layout', done: true },
      { id: 's2', title: 'Tablet layout', done: true },
      { id: 's3', title: 'Mobile layout', done: true },
      { id: 's4', title: 'Annotate interactions', done: false },
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
      { id: 's5', title: 'Primary nav structure', done: true },
      { id: 's6', title: 'Mega-menu content', done: false },
      { id: 's7', title: 'Mobile drawer behavior', done: false },
    ],
  });
  t('p1', 'Design responsive navigation', 'progress', 'm4', 'medium', 3, ['design'], {
    est: '3d',
    len: 6,
    subtasks: [
      { id: 's8', title: 'Breakpoint rules', done: true },
      { id: 's9', title: 'Sticky header states', done: false },
    ],
  });
  t('p1', 'Prepare design system tokens', 'todo', 'm1', 'medium', 6, ['design'], { est: '2d', len: 4 });
  t('p1', 'Review responsive layouts', 'todo', 'm4', 'medium', 8, ['qa', 'design'], { est: '1d', len: 3 });
  t('p1', 'Prepare developer handoff', 'todo', 'm2', 'high', 14, ['frontend'], { est: '2d', len: 4, deps: ['t3', 't5'] });
  t('p1', 'Design mobile onboarding', 'progress', 'm4', 'urgent', -1, ['design'], {
    est: '3d',
    len: 6,
    subtasks: [
      { id: 's10', title: 'Welcome screens', done: true },
      { id: 's11', title: 'Permission prompts', done: false },
      { id: 's12', title: 'Empty states', done: false },
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
      { id: 's20', title: 'Docs published', done: true },
      { id: 's21', title: 'Pricing live', done: false },
      { id: 's22', title: 'Support trained', done: false },
      { id: 's23', title: 'Status page updated', done: true },
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
  const A = (by: string, verb: string, task: string | null, project: string, m: number, extra = ''): Activity => ({ id: uid('a'), by, verb, task, project, at: minsAgo(m), extra });
  const activity: Activity[] = [
    A('m2', 'moved', 't3', 'p1', 38, 'to Review'),
    A('m3', 'completed', 't18', 'p1', 90),
    A('m4', 'commented on', 't19', 'p2', 140),
    A('m1', 'changed priority of', 't9', 'p1', 180, 'to Urgent'),
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
    { id: 'n2', type: 'assign', by: 'm3', task: 't28', text: 'assigned you', snippet: 'Due today · Medium priority', at: minsAgo(300), read: false },
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
  const tmp = tk('t3');
  tmp.updated = minsAgo(38);
  return {
    ws: { name: 'Gr8r Studio', url: 'gr8rstudio', c: '#1D1C1A', brand: true },
    me: 'm1',
    members,
    projects,
    tasks: T,
    activity,
    notifs,
    teams: TEAMS_SEED.map(x => ({ ...x })),
    projOrder: projects.map(p => p.id),
  };
}
