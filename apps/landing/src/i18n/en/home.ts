/* English dictionary — home page */
import type { Dict } from '../types';

export const enHome: Dict['home'] = {
  title: 'FutureERP — deals, production, and finance in one system',
  description: 'FutureERP replaces spreadsheets, separate CRMs, and legacy ERPs: every order moves from lead to payment in one place.',
  nav: {
    label: 'Main navigation',
    modules: 'Modules',
    how: 'How it works',
    compare: 'Compare',
    price: 'Pricing',
    faq: 'FAQ',
    signIn: 'Sign in',
    openDemo: 'Open demo',
    menu: 'Menu',
  },
  hero: {
    audience: 'For manufacturing and service businesses',
    titleStart: 'Deals, production, and finance — ',
    titleAccent: 'in one system',
    titleEnd: ' instead of legacy ERP, CRM, and spreadsheets',
    lead: 'Every order moves from inquiry to payment in one workspace: no exports, double entry, or fragile integrations.',
    demo: 'Open demo',
    call: 'Book a live walkthrough',
    hint: 'Demo company pre-filled with realistic data',
    recLabel: 'Screen recording: CRM overview',
    recCaption: 'Recording: a deal moves to the “Won” stage, stage totals recalculate, and channel revenue and ROMI grow in the analytics report.',
  },
  facts: {
    label: 'System highlights',
    items: [
      ['Modular setup', 'pay only for what you use'],
      ['Self-hosted option', 'deploy on your own server'],
      ['Isolated data', 'each company is separated at the database level'],
      ['Structured documents', 'headers, line items, and transactional posting'],
    ],
  },
  modules: {
    title: 'Nine modules, one database',
    lead: 'Customers, products, and money are entered once — and immediately available across tasks, deals, documents, and inventory.',
    tabs: 'Modules',
    soon: 'Screen recording for this module is coming soon.',
    more: 'Learn more',
  },
  flow: {
    label: 'How it works',
    title: 'One order flows through every module — never entered twice',
  },
  compare: {
    title: 'Instead of three disconnected tools',
    lead: 'How a small business usually operates — and what changes with FutureERP.',
    criterion: 'Comparison',
    was: 'Legacy ERP + CRM + spreadsheets',
    now: 'FutureERP',
    rows: [
      ['Deals and orders', 'in separate apps, data copied manually', 'in one record: a deal becomes an order'],
      ['Stock and balances', 'scheduled syncs or manual exports', 'update instantly when a document is posted'],
      ['Connecting tools', 'integrators and ongoing sync maintenance', 'single database — no integrations needed'],
      ['Pricing', 'full license for each separate system', 'only for the modules you enable'],
      ['Data hosting', 'scattered across third-party vendors', 'cloud or your own server'],
    ],
  },
  price: {
    title: 'Pricing tailored to your workflows',
    lead: 'Cost depends on active modules, team size, and data migration scope. We will discuss it on a call and send a clear proposal.',
    steps: [
      ['Discovery call', 'Tell us how your operations work: sales, inventory, production, and finances.'],
      ['Tailored walkthrough', 'We run your exact order scenario in the demo and pick the modules you need.'],
      ['Proposal', 'We send the module bundle, data migration plan, timeline, and pricing.'],
    ],
    ctaTitle: 'Let’s discuss what fits your team',
    ctaText: 'Start with only the modules you need — add more later without migrating data.',
    cta: 'Discuss pricing',
    demo: 'Try the demo first',
  },
  faq: {
    title: 'Frequently asked questions',
    items: [
      ['Can we import data from spreadsheets or another ERP?', 'Prices import from XLSX or CSV matched by SKU, and bank statements import from bank files. We will plan the rest of your migration on a call.'],
      ['Do we need a developer to connect modules?', 'No. Every module shares one database: deals, orders, inventory, and finances are connected out of the box.'],
      ['Can we self-host on our own server?', 'Yes, FutureERP can be deployed on your own infrastructure. Each company’s data is isolated at the database level.'],
      ['What happens if we enable another module later?', 'It immediately sees your existing customers, items, and documents — nothing needs to be re-entered.'],
    ],
  },
  final: {
    title: 'See your workflow in FutureERP',
    lead: 'Open the demo company right now or leave a request — we will walk you through your exact processes.',
    demo: 'Open demo',
  },
};
