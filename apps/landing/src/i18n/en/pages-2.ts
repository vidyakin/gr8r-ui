/* English dictionary — module pages (services, production, sales) */
import type { Dict } from '../types';

export const enPages2: Pick<Dict['modulePages'], 'services' | 'production' | 'sales'> = {
  services: {
    features: [
      {
        title: 'Specialist booking',
        text: 'Each specialist has their own schedule: slot duration and working hours by day of week. View a daily grid of all specialists or a full week for one.',
        list: ['15, 30, 45, 60, or 90-minute slots', 'Holidays and date-specific exceptions', 'Prevents double-booking or out-of-hours slots', 'Reschedule to another time or specialist'],
        screen: 'Daily booking grid: specialist columns, appointments, and open slots',
      },
      {
        title: 'Visit statuses and client history',
        text: 'Appointments move from “booked” to “arrived”. The day before, the owner receives a “Confirm appointment” reminder. No-shows and cancellations free up slots.',
        list: ['Statuses: booked, confirmed, arrived, no-show, canceled', 'Cancellation reasons recorded', '“Appointments” tab on the client card: upcoming, past, no-shows'],
        screen: 'Appointment card with status, client, and “Arrived” / “No-show” actions',
      },
      {
        title: 'Closing a specialist’s day',
        text: 'The “Daily Services Rendered” document fills automatically from “arrived” appointments. Posting generates an act or shipment for each client.',
        list: ['One document per specialist per day', 'List of unclosed days with alerts for staff and managers', 'Revenue, client balance, and stock deduction flow normally'],
        screen: '“Unclosed days” tab listing specialist days without a closing document',
      },
      {
        title: 'Work orders and job costing',
        text: 'A work order combines labor, materials, and assignees in one sales document. Companies define their own statuses; moving to “completed” posts the document.',
        list: ['Assignees become tasks with planned hours by standard', 'Labor cost = hours × shop rate, plus materials', 'Work order margin visible to admins and owners'],
        screen: 'Work orders register with statuses, cost, and margin',
      },
    ],
    chain: [
      ['crm', 'Client: contact or company; walk-in individuals with a phone are created right in the booking dialog.'],
      ['services', 'Appointment, then work order with labor and materials.'],
      ['tasks', 'Work order assignee is a task with planned hours; logged time flows to the timesheet.'],
      ['sales', 'Completed work order posts as a sale: revenue, receivable, and material deduction.'],
    ],
    faq: [
      ['Can we book a client who is not in the CRM yet?', 'Yes. You can create a new individual with a phone number right inside the booking dialog.'],
      ['What happens on a no-show?', 'The appointment is marked “no-show” and the slot frees up. No-shows are visible in the client card’s Appointments tab.'],
      ['How is work order cost calculated?', 'Labor (hours × shop rate) plus materials and goods at warehouse average cost plus other direct expenses. Margin is revenue minus cost.'],
      ['Who can see job cost and margin?', 'Only admins and owners. For other roles, cost and margin columns stay blank.'],
    ],
  },
  production: {
    features: [
      {
        title: 'Bills of materials (BOMs)',
        text: 'A product BOM includes raw materials, sub-assemblies, and operations. Sub-assemblies can be produced to stock or exploded down to raw materials in the same run.',
        list: ['Waste percentage per material', 'Multi-level BOM tree with cycle prevention', 'Overhead percentage and manufacturing lead time in days'],
        screen: 'Product BOM: materials, sub-assemblies, and operations',
      },
      {
        title: 'Production orders',
        text: 'Create production orders from customer orders or by schedule. Orders move from “planned” to “closed” while locking in a snapshot of the product BOM.',
        list: ['Statuses: planned, in progress, completed, closed', 'Remaining output tracked per order line', 'Cannot output more than ordered'],
        screen: 'Production orders register with statuses',
      },
      {
        title: '“Production Output” workspace',
        text: 'Shop leads see every order with remaining output: ordered, produced, shipped, remaining. Post an output document in a single action.',
        list: ['Simple mode outputs full remainder; advanced mode takes custom quantities', 'One output document per shop, date, and stage', 'Shortage of materials aborts atomically — nothing partial is created', 'Finished goods reserve automatically for the customer order'],
        screen: '“Production Output” workspace showing orders and stages',
      },
      {
        title: 'Stages and piecework pay',
        text: 'Each production type defines its own stages; only the final stage receives finished goods into stock. Piecework job tickets pull the rate effective on the ticket date.',
        list: ['Historical piecework rates by date', 'Pay per unit produced or per standard hour', 'Full product cost calculated at month-end close'],
        screen: 'Production stages directory and piecework job ticket',
      },
    ],
    chain: [
      ['docs', 'Customer order with items set to be replenished via production.'],
      ['production', 'Production order, stage-by-stage output; finished goods reserve for the order.'],
      ['sales', 'Shipment created from the order deducts finished goods from stock.'],
      ['payroll', 'Piecework totals pull from posted job tickets into monthly payroll.'],
    ],
    faq: [
      ['What if raw materials are short?', 'Output is blocked: the entire transaction rolls back cleanly and nothing is created.'],
      ['Can we produce more than ordered?', 'No. Remaining quantities are tracked per order line and over-production is rejected.'],
      ['Is a shop/department required?', 'Yes. Output requires a manufacturing department, which also provides default warehouses.'],
      ['How is piecework pay calculated?', 'By the rate effective on the job ticket date — per unit or per standard hour. Line amounts can be adjusted before posting.'],
    ],
  },
  sales: {
    features: [
      {
        title: 'From order to shipment',
        text: 'Customer orders track every line: ordered, fulfilled, and planned. Invoices, shipments, and acts are created directly from the order.',
        list: ['Delivery date per order line', 'Fulfillment never exceeds ordered quantity', 'Customer returns created directly from shipments'],
        screen: 'Customer orders register with remaining quantities to ship',
      },
      {
        title: 'Inventory and reservations',
        text: 'Posting a shipment updates stock immediately. On-hand quantities and average cost update in the same transaction so concurrent postings never cause negative stock.',
        list: ['Order reserve = ordered minus shipped', 'Available = on-hand minus reserves', 'Service items do not affect warehouse stock'],
        screen: 'Warehouse stock report with reserved and available columns',
      },
      {
        title: 'Payments and balances',
        text: 'Record payments via cash receipts or bank documents, including directly from an invoice, order, or shipment. Counterparty balances are always visible on their card.',
        list: ['Cash flow category on every payment line', 'Import bank statements from file', 'Payment status indicator in document registers', 'Negative cash balance shows a warning without blocking posting'],
        screen: 'Payments register: inflows, outflows, and cash/bank balances',
      },
      {
        title: 'Sales P&L and ABC assortment analysis',
        text: 'Track gross profit and margin without spreadsheets. Unit cost is locked at posting time so historical periods never drift, and ABC analysis highlights top-performing items by revenue and profit.',
        list: [
          'Sales P&L across 6 groupings: product, category, client, manager, organization, and warehouse',
          'Cost locked at shipment posting time for accurate historical gross profit and margin',
          'ABC assortment analysis by revenue and profit with configurable thresholds (default 80/15/5%)',
          'One-click XLSX export for both P&L and ABC reports',
        ],
        screen: 'Sales P&L report and ABC assortment analysis with XLSX export',
      },
      {
        title: 'EAN-13 barcodes, labels, and price tags',
        text: 'Generate internal EAN-13 barcodes individually or in bulk and print barcode labels or price tags directly from the product catalog or goods receipts with live PDF preview.',
        list: [
          'Single and bulk internal EAN-13 barcode generation with check digit',
          'Printable barcode labels in 58×40 and 43×25 mm formats for thermal printers',
          'Price tags in A6 and A4 grid layouts with live preview and PDF export',
          'Launch printing straight from the catalog or from posted goods receipts',
        ],
        screen: 'Live preview of 58×40 mm barcode labels and A6/A4 price tags with EAN-13',
      },
    ],
    chain: [
      ['docs', 'Quote, customer order, and invoice created in one chain.'],
      ['sales', 'Shipment posts: inventory, revenue, and customer receivable.'],
      ['logistics', 'Delivery is configured right on the customer order or shipment.'],
      ['crm', 'Revenue from posted shipments feeds into the ad channel report.'],
    ],
    faq: [
      ['Can we ship an order in parts?', 'Yes. Shipments are generated for the remaining balance until every line is fulfilled.'],
      ['What if stock is insufficient?', 'Posting checks physical on-hand stock. Reservations for other orders do not block posting.'],
      ['What if a cash desk has insufficient funds?', 'The system warns about a negative balance but still allows posting the document.'],
      ['How do we record a return?', 'Create a customer return from a shipment, or a vendor return from a goods receipt.'],
      ['How are P&L profit and ABC analysis calculated?', 'Cost is locked when a shipment is posted. Sales P&L reports gross profit and margin across 6 groupings (product, category, client, manager, organization, warehouse), while ABC analysis classifies items by revenue and profit with configurable 80/15/5 thresholds and XLSX export.'],
      ['What barcode label and price tag formats are supported?', 'You can generate internal EAN-13 barcodes singly or in bulk and export PDFs with live preview for 58×40 and 43×25 mm labels as well as A6 and A4 grid price tags directly from the catalog or goods receipts.'],
    ],
  },
};
