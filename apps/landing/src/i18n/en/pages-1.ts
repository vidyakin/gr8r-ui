/* English dictionary — module pages (ui, tasks, crm, docs) */
import type { Dict } from '../types';

export const enPages1: Pick<Dict['modulePages'], 'ui' | 'tasks' | 'crm' | 'docs'> = {
  ui: {
    nav: 'Module page',
    all: 'All modules',
    demo: 'Open demo',
    request: 'Request a demo',
    moduleLabel: 'Module',
    recLabel: 'Screen recording of the “{name}” module',
    shotSoon: 'Screenshot coming soon',
    zoomOpen: 'View full size',
    zoomClose: 'Close',
    chainTitle: 'How it connects to other modules',
    chainLead: 'All modules share one database: data flows downstream with no manual transfers or integrations.',
    chainCurrent: 'This module',
    chainPasses: 'Passed next',
    chainResult: 'Outcome',
    faqTitle: 'Module FAQ',
    finalTitle: 'See the “{name}” module on your workflows',
    finalLead: 'Open the demo company right now or leave a request — we will configure the module for your processes.',
    otherTitle: 'Other modules',
  },
  tasks: {
    features: [
      {
        title: 'Five views of the same work',
        text: 'Open any project as a board, list, table, calendar, or timeline — all backed by the same data. Every task has a due date, assignee, and priority.',
        list: ['Priority from 1 to 10 and color tags', 'Subtasks and scheduled recurrence', 'Saved views with custom filters'],
        screen: 'Project board: status columns and task cards',
      },
      {
        title: 'Task time tracking',
        text: 'Hours are logged directly against tasks and compared to estimates: planned hours equal quantity times standard work duration. Weekly employee timesheets build automatically from these entries.',
        list: ['Timesheet rows: date, employee, customer, work type, task, hours', 'Customer link on tasks for work outside work orders', 'Admins and owners see any timesheet; members see their own'],
        screen: 'Weekly employee timesheet with hours by task',
      },
      {
        title: 'Production and service tasks',
        text: 'Projects and tasks carry a module scope: general, production, or services. Module tasks stay in their own projects without cluttering general lists.',
        list: ['Task keys like PROD-1 and SERV-3', 'Task module is inherited from its project', 'Filter by module in lists, boards, and saved views'],
        screen: 'My Tasks: general and module tasks in one unified list',
      },
      {
        title: 'Interactive whiteboards in the core',
        text: 'A Miro/Figma-style infinite canvas is included in the base core at no extra cost: map workflows, brainstorm ideas, and link them straight to live team execution.',
        list: [
          'Sticky notes, shapes, sections, connector arrows, freehand drawing, smart alignment, and PNG/SVG export',
          'Live ERP/CRM cards right on the canvas (tasks, deals, companies) with inline completion checkboxes',
          'One-click sticky-to-task conversion and ready-made templates: SWOT analysis, customer journey map, roadmap',
        ],
        screen: 'Interactive whiteboard: sticky notes, sections, and live task and deal cards on the canvas',
      },
    ],
    chain: [
      ['crm', 'Deal event: created, updated, or moved to a new stage.'],
      ['automations', 'A rule creates a task and assigns an owner.'],
      ['tasks', 'Task lives in the right module project; time is logged to it.'],
      ['services', 'A work order assignee is a services task whose hours flow into the timesheet.'],
    ],
    faq: [
      ['Can we keep production and service tasks separate from general tasks?', 'Yes. Each project has a module scope: general, production, or services. Tasks inherit the scope and get a prefix like PROD or SERV.'],
      ['How is time tracked?', 'Time is logged against a task. Weekly timesheets aggregate those entries by date, employee, customer, work type, task, and hours. Planned hours are based on work time standards.'],
      ['Who can view timesheets?', 'Admins and owners can view any employee’s timesheet; regular members see only their own.'],
      ['What views are available for a project?', 'Board, list, table, calendar, and timeline. Any filter setup can be saved as a reusable view.'],
      ['Are interactive whiteboards billed separately?', 'No. Whiteboards are included in the base core at no extra cost, complete with an infinite canvas, team templates, live task/deal/company cards, and one-click sticky-to-task conversion.'],
    ],
  },
  crm: {
    features: [
      {
        title: 'Website leads',
        text: 'Inquiries arrive from website forms straight into lead statuses. A lead represents a person or company before they become a customer; converting it creates a counterparty and a deal.',
        list: ['Web form with a secret token and source tracking', 'Round-robin assignment of new leads across owners', 'Lead touchpoints: type, subject, and notes'],
        screen: 'Leads list with statuses, sources, and owners',
      },
      {
        title: 'Pipelines and deals',
        text: 'Run multiple sales pipelines. Each stage has a win probability and SLA duration, and every stage transition is recorded in history.',
        list: ['Stage win probability from 0 to 100%', 'Required fields on stage entry', 'Customizable loss reasons directory', 'Alerts when a deal stalls in a stage'],
        screen: 'Sales pipeline: stages, stage totals, and deal cards',
      },
      {
        title: 'Sources and ad ROI',
        text: 'Acquisition source and campaign stay attached to leads, deals, and sales documents. Enter campaign costs manually and let the channel report calculate your return.',
        list: ['Source types: channel, partner, contact person', 'Campaigns match leads automatically via utm_campaign', 'Conversion rate, cost per lead and customer, ROMI', 'Revenue pulled from posted sales shipments'],
        screen: 'Ad channel report: spend, revenue, and ROMI',
      },
      {
        title: 'Embeddable AI chat widget & multilingual chats',
        text: 'Drop a single <script> tag onto any company website. The bot answers from your knowledge base, runs only on allowed domains, plays a soft chime, and hands off to a manager in one click inside built-in Chats with automatic contextual translation.',
        list: [
          'Embed on any website via <script> with a domain allowlist and custom company knowledge base',
          'Soft message chime plus configurable tone and greeting per language (RU, EN, ES)',
          'One-click “Call manager” handoff into built-in multilingual Chats with automatic contextual translation',
          'Full chat history in CRM and one-click lead creation linked to the transcript',
        ],
        screen: 'CRM AI Chats: embeddable widget, multilingual auto-translated chats, and manager handoff',
      },
      {
        title: 'Position-based access control & hidden fields',
        text: 'Restrict record visibility by position right at the database layer (PostgreSQL RLS) and hide sensitive fields from team members who do not need to see them.',
        list: [
          'Record-level scope by position: “All”, “Department + sub-departments”, or “Own only”',
          'Enforced via PostgreSQL RLS across both the UI and API',
          'Field-level hiding for deal amounts and probabilities, phones and emails, bank details, document totals, and custom hidden fields',
        ],
        screen: 'Position permissions: record visibility scope and hidden sensitive fields',
      },
    ],
    chain: [
      ['crm', 'Customer, deal, acquisition source, and campaign.'],
      ['docs', 'Quotes, orders, and invoices created from one another, preserving source and campaign.'],
      ['production', 'A customer order becomes a production order.'],
      ['sales', 'Posted shipments with a source feed revenue directly into the channel report.'],
    ],
    faq: [
      ['What happens to a lead after conversion?', 'A customer and a deal are created. Source and campaign transfer over; for an existing customer, the source is set only if empty.'],
      ['Can we customize our own pipeline?', 'Yes. You can create multiple pipelines and configure category, probability, SLA days, and required fields per stage. Each pipeline requires won, lost, and open stages.'],
      ['How is ad ROI calculated?', 'ROMI equals (revenue − spend) / spend. Revenue comes from posted shipments tagged with the source; campaign spend is entered manually.'],
      ['How is a campaign linked to a lead?', 'Via utm_campaign passed from the web form and matched to an active campaign. Archived campaigns are not matched.'],
      ['How does the embeddable AI widget work with managers?', 'Embed it on any website with a <script> tag and domain allowlist so it answers from your company knowledge base. Clicking “Call manager” hands the chat over to built-in multilingual Chats with automatic contextual translation, and any chat converts into a lead in one click.'],
      ['Can we hide deal amounts and client contacts from certain roles?', 'Yes. Each position has a record visibility scope (“All”, “Department + sub-departments”, or “Own only”, enforced by PostgreSQL RLS) and a list of hidden fields: deal amounts/probabilities, phones/emails, bank details, document totals, and custom fields.'],
    ],
  },
  docs: {
    features: [
      {
        title: 'Consistent ERP documents',
        text: 'Header on top, line-item tabs below. Invoices, orders, shipments, acts, receipts, and purchases all share the same layout so teams learn it once.',
        list: ['Price tier fills unit prices automatically', 'VAT inclusive or exclusive, amount in words', 'Per-line cent rounding so totals always match the PDF'],
        screen: 'Sales shipment document: header and item table',
      },
      {
        title: 'Posting and numbering',
        text: 'Drafts have no document number: numbers are assigned on posting so abandoned drafts never leave gaps. Posting validates counterparty, lines, and stock.',
        list: ['Number format like INV-2026-00042', 'Posted documents are locked — unpost first to edit', 'Cancel a document or return a canceled one to draft'],
        screen: 'Posted invoice with assigned number and totals',
      },
      {
        title: 'Create from source document',
        text: 'Generate the next document in the chain from the previous one: header and lines copy over with quantities set to the remaining balance.',
        list: ['Quote → customer order or invoice', 'Customer order → invoice, shipment, or act', 'Shipment → customer return', 'Purchase order → goods receipt'],
        screen: 'Customer order showing fulfilled and planned quantities per line',
      },
      {
        title: 'Quotes, contracts, and PDFs',
        text: 'Build quotes from multiple options and grouped lines, apply a template, and export to PDF. Contracts support templates too.',
        list: ['Multiple quote options with primary selection', 'Toggle product images in templates with a checkbox', 'Export multiple invoices in a single ZIP archive'],
        screen: 'Printable quote PDF layout',
      },
    ],
    chain: [
      ['crm', 'Customer, owner, and acquisition source.'],
      ['docs', 'Quote → order → invoice generated in one chain.'],
      ['sales', 'Shipment created from an order or invoice updates stock and balances.'],
      ['logistics', 'Orders, shipments, and work orders include a “Delivery” tab.'],
    ],
    faq: [
      ['When does a document get its number?', 'Upon posting. Drafts have no number and numbers never repeat. Unposting and re-posting keeps the same number.'],
      ['Can a posted document be edited?', 'No — unpost it first. Unposting is blocked while downstream documents created from it remain posted.'],
      ['Can you ship more than ordered?', 'No. Fulfillment cannot exceed ordered quantities; new documents default to the remaining balance.'],
      ['How do we get a printable PDF?', 'Open the print view right from any document and download PDF. Multiple invoices can be exported as one archive.'],
    ],
  },
};
