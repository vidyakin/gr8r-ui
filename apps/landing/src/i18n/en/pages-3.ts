/* English dictionary — module pages (logistics, automations, payroll) */
import type { Dict } from '../types';

export const enPages3: Pick<Dict['modulePages'], 'logistics' | 'automations' | 'payroll'> = {
  logistics: {
    features: [
      {
        title: 'Order deliveries',
        text: 'Attach delivery details to customer orders, shipments, or work orders: method, address, time window, weight, and pricing. Address and contact pull from the customer.',
        list: ['Methods: in-house courier, delivery service, third-party carrier', 'Tariffs: base fee, per kilometer, and per kilogram', 'Free delivery threshold for customers'],
        screen: 'Deliveries register with statuses and couriers',
      },
      {
        title: 'Couriers and statuses',
        text: 'Deliveries move from “new” to “delivered”. Couriers see only their assigned runs in a dedicated list.',
        list: ['Statuses: new, assigned, in transit, delivered, failed', 'Couriers are employees with the “Courier” role', 'Completed deliveries book delivery cost to the “Delivery” expense category'],
        screen: 'Route card: vehicle, driver, and ordered stops',
      },
      {
        title: 'Routes and dispatch',
        text: 'Group stops into city or intercity routes. One click distributes the day’s deliveries across available vehicles and optimizes stop order.',
        list: ['Delivery and route-stop statuses stay in sync', 'A delivery cannot be placed in two active routes', 'Distances via straight line, Maps API, or self-hosted OSRM/VROOM', 'ETA calculation respecting time windows'],
        screen: 'Route dispatcher: unassigned deliveries, vehicles, and map',
      },
      {
        title: 'Fleet and freight orders',
        text: 'Track vehicles, drivers, waybills, fuel, fines, and maintenance in one fleet registry. Freight orders calculate carrier rates and route margin.',
        list: ['Vehicle document expiration reminders', 'Lane tariffs: per trip, per kilometer, per ton', 'Hired carrier and additional route expenses'],
        screen: 'Fleet vehicle list with document expiration dates',
      },
    ],
    chain: [
      ['sales', 'Customer order or shipment with address, weight, and amount.'],
      ['logistics', 'Delivery, then route with stops; driver sees assigned deliveries.'],
      ['automations', 'Route status changes can trigger automation workflows.'],
      ['payroll', 'Payroll includes driver trip accruals from completed routes.'],
    ],
    faq: [
      ['Do we need an external maps service?', 'No. Without a provider, distances use straight-line estimates with a road factor and average speed. You can connect Maps API or self-hosted OSRM/VROOM anytime.'],
      ['What about the cost of free delivery?', 'The client pays zero, while actual delivery cost is still recorded under the “Delivery” expense category.'],
      ['Can one delivery be added to two routes?', 'No. A delivery cannot belong to two active routes at the same time.'],
      ['Are routes and fleet included in the base package?', 'Routes, fleet, and freight orders belong to the transport tier and can be enabled separately.'],
    ],
  },
  automations: {
    features: [
      {
        title: 'Visual rule canvas',
        text: 'Assemble rules as a flowchart: what happened, under what conditions, and what actions to take. Schemas are validated before publishing so rules cannot hang or loop.',
        list: ['Exactly one trigger per rule', 'No dangling nodes or infinite loops', 'Up to 60 nodes and 150 connections'],
        screen: 'Rule editor: trigger, condition, and actions on canvas',
      },
      {
        title: 'Triggers and logic',
        text: 'Start rules on record events, cron schedules, or manually. Insert conditions, branches, or delays between triggers and actions.',
        list: ['Record created, updated, or field changed: task, project, deal, company, contact, item, document', 'Schedules in your company’s time zone', 'Conditions: equals, greater than, contains, empty, and more', 'Delays up to 30 days'],
        screen: '“Field changed” trigger settings and condition node',
      },
      {
        title: 'Actions and templates',
        text: 'Update a record field, create a task, notify a teammate, add a comment, or send an HTTP request. Inject dynamic values straight from the trigger event.',
        list: ['Task comments or deal notes', 'Template variables like {{trigger.record.title}}', 'Secret headers automatically masked in run history'],
        screen: '“Create task” node with dynamic deal placeholders',
      },
      {
        title: 'Versioning and run history',
        text: 'Published versions are immutable: editing a draft never disrupts a live workflow. Every run and every step is logged.',
        list: ['Run statuses: queued, running, waiting, succeeded, failed', 'Per-step input, output, and error details', 'Duplicate event delivery never triggers a second run'],
        screen: 'Workflow run history with per-step trace',
      },
    ],
    chain: [
      ['crm', 'Event: deal created, updated, or moved to another stage.'],
      ['automations', 'Rule checks conditions and executes actions.'],
      ['tasks', 'A task is created and the assignee is notified.'],
    ],
    faq: [
      ['Do we need a developer to build a rule?', 'No. Rules are built visually on a canvas with auto-generated parameter forms.'],
      ['What if a rule loops infinitely?', 'Loop protection rejects recursive triggers and marks the run as “skipped”.'],
      ['Can we send data to an external service?', 'Yes, via the “HTTP request” action, with built-in SSRF protection against internal network requests.'],
      ['Can an action be delayed?', 'Yes. The “Delay” node pauses execution for up to 30 days.'],
    ],
  },
  payroll: {
    features: [
      {
        title: 'Employee records and recurring pay',
        text: 'Store hire/termination dates, entity, department, and tax rate per employee. Recurring pay items keep full effective-date history.',
        list: ['Fixed salary or flat bonuses', 'Sales commission based on revenue or margin', 'Bank account or card for payout files'],
        screen: 'Employee card: HR details and recurring pay items',
      },
      {
        title: 'Monthly payroll accrual',
        text: 'Fill the “Payroll Accrual” document in one click: timesheet salary, piecework, sales commissions, and bonuses. One-off additions and deductions stay untouched.',
        list: ['Salary prorated by working days and holidays', 'Piecework pulled from posted job tickets, matching output reports', 'Employee tax and company contributions calculated automatically', 'All amounts can be adjusted manually before posting'],
        screen: '“Payroll Accrual” document with per-employee breakdown',
      },
      {
        title: 'Pay sheets and payouts',
        text: 'Run advance or final pay sheets via cash desk or bank. Payouts create cash/bank documents and update sheet status: unpaid, partial, or paid.',
        list: ['Bank payout CSV file: full name, account, amount', 'Printable payroll register', 'Employee self-service pay stub'],
        screen: 'Pay sheet showing payout status',
      },
      {
        title: 'Expenses and reporting',
        text: 'Posting an accrual books labor expenses to the accrual month by category and department. Piecework is never double-counted — it is already in production cost.',
        list: ['Employee ledger: accruals, taxes, deductions, payouts', 'Closed accounting periods enforced on posting', 'Payroll reports and individual pay stubs'],
        screen: 'Payroll reports for the period',
      },
    ],
    chain: [
      ['production', 'Piecework totals from posted job tickets.'],
      ['sales', 'Sales commission from documents owned by the employee.'],
      ['payroll', 'Accrual, pay sheet, payout, and expenses by category and department.'],
    ],
    faq: [
      ['Does it include statutory tax filings or sick leave?', 'No. This is managerial payroll: accruals, deductions, employee tax rate, and employer contributions to expenses. Statutory filings are outside scope.'],
      ['Where does piecework pay come from?', 'From posted piecework job tickets — totals match the production output report.'],
      ['How are employer contributions configured?', 'Set as a company-wide percentage (default 30%). Individual accrual types can be marked exempt.'],
      ['Who has access to payroll?', 'Only admins and owners. Regular employees can only view their own pay stubs.'],
    ],
  },
};
