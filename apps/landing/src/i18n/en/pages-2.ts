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
        title: 'BOMs and parametric manufacturing',
        text: 'Product BOMs combine raw materials, sub-assemblies, operations, and output by-products (for cutting or disassembly). Parametric BOMs let you enter dimensions, materials, and options right on the order — quantities and unit cost recalculate automatically.',
        list: [
          'Product parameters (number, choice list, checkbox) with “stock dimension” variants without bloating the catalog',
          'Multi-level sub-assembly trees of any depth with cycle prevention',
          'Material waste percentages, returnable waste, overhead rates, and manufacturing lead time in days',
        ],
        screen: 'Parametric product BOM: parameters, materials, sub-assemblies, and operations',
      },
      {
        title: 'Production orders and material availability',
        text: 'Create production orders from customer orders or schedules while locking in a BOM snapshot. Availability indicators show stock and reservations across warehouses — buy shortages or launch sub-assemblies in one click.',
        list: [
          'Order lifecycle from “planned” to “closed” with remaining output tracking per line',
          'Color-coded material availability and reservation breakdown by warehouse',
          'Create semi-finished orders, purchase orders, and shop-floor stock transfers straight from the order',
        ],
        screen: 'Production order card with material availability and reservations',
      },
      {
        title: '“Production Output” workspace, WIP, and defects',
        text: 'Shop leads see every order with remaining output and post output per department, date, and stage in one action. Intermediate stages build work-in-progress (WIP), while the final stage receives finished goods into stock and reserves them for the order.',
        list: [
          'Simple mode for full remainder; advanced mode for partial runs, returnable waste, and defects',
          'WIP balances and movement tracked by shop floor and order',
          'Defect reason directory and atomic material checks with zero partial postings',
        ],
        screen: '“Production Output” workspace showing orders, stages, WIP, and defect logging',
      },
      {
        title: 'Stages, piecework pay, and shift material allocation',
        text: 'Each production type defines its own routing stages. Piecework job tickets pull effective rates by date, and the shift material allocation document distributes actual material consumption across a shop’s runs.',
        list: [
          'Historical piecework rates by date: per unit produced or per standard hour',
          'Log completed quantities directly from the operation block inside an employee’s task',
          'Distribute actual shift material usage across production runs with manual overrides',
        ],
        screen: 'Production stages, piecework job ticket, and shift material allocation',
      },
      {
        title: 'Production planning and MRP needs calculation',
        text: 'Build period-by-period production plans from sales history, output history, and customer orders. A 3-step MRP wizard automatically calculates what to purchase and what to manufacture.',
        list: [
          'Period plans with “Needs” (materials and shop hours vs. capacity) and “Plan vs. fact” tabs',
          '“Orders from plan” workspace generating draft orders for the remaining gap without duplicates',
          '3-step MRP wizard (Recommendations → Planning → Orders) across horizons, warehouses, and replenishment rules',
        ],
        screen: 'Period production plan and 3-step MRP needs wizard',
      },
      {
        title: 'Equipment load planner and shift calendars',
        text: 'A visual load planner displays employees, work centers, and key equipment on a timeline. Drag operations to reschedule and spot overloads immediately.',
        list: [
          'Drag-and-drop load planner for work centers, operators, and machines with overload highlights',
          'Key resources and work centers directory with hourly rates',
          'Shift work calendars, workspace holidays, and exceptions (maintenance, vacation, sick leave)',
        ],
        screen: 'Work center and equipment load planner with shift calendars',
      },
      {
        title: 'Month-end close, overhead costing, and tolling',
        text: 'At period end, the month-close wizard gathers direct and indirect costs (rent, utilities, depreciation) and allocates them across outputs. Toll manufacturing (customer-supplied raw materials) is supported out of the box.',
        list: [
          '“Other costs” documents by expense item and work center with pre-close diagnostics',
          'Automated indirect cost allocation across outputs and safe close reversal',
          'Toll processing: processing orders, customer material receipts, processing reports, and owner balances',
        ],
        screen: 'Month-end close wizard with indirect cost allocation across outputs',
      },
      {
        title: 'Manufacturing analytics and costing reports',
        text: 'Nine built-in reports with collapsible groupings, charts, and CSV export. Cost figures are role-protected — only admins and owners see monetary columns.',
        list: [
          'Plan vs. fact output and plan vs. fact costing highlighting material overuse and savings',
          'Output cost breakdown by direct and indirect expense items plus standard BOM explosion',
          'Reports for production orders, WIP movement, work center load, defects, and bidirectional batch traceability (from raw material supplier to customer shipment)',
        ],
        screen: 'Manufacturing reports: cost plan vs. fact, output, WIP movement, and defect analysis',
      },
    ],
    chain: [
      ['docs', 'Customer order with items (including parametric products) replenished via production.'],
      ['production', 'MRP needs calculation, plans and production orders, stage output, and month-end close.'],
      ['sales', 'Shipment created from the order deducts reserved finished goods with accurate cost.'],
      ['payroll', 'Piecework totals pull from posted job tickets into monthly payroll.'],
    ],
    faq: [
      ['Does it support parametric make-to-order products (furniture, windows, metalwork)?', 'Yes. Define parameters (number, list, checkbox) and stock dimensions in the BOM. Enter values on the order line and the system recalculates material norms and cost without creating thousands of SKUs.'],
      ['How does MRP needs calculation work?', 'The 3-step wizard (Recommendations → Planning → Orders) evaluates stock, reservations, orders, and plans over your horizon and generates draft purchase and production orders.'],
      ['What if raw materials are short?', 'Output is blocked: the entire transaction rolls back cleanly. Shortages can be ordered from suppliers or transferred to the shop floor directly from the production order.'],
      ['How is full cost with overheads calculated?', 'Indirect expenses are logged in “Other costs” by item and work center, then the month-end close wizard allocates them across the period’s outputs.'],
      ['How is piecework pay calculated?', 'By the rate effective on the job ticket date — per unit or per standard hour. Line amounts can be adjusted before posting and flow into payroll.'],
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
      {
        title: 'Warehouse bin locations & batch origin / customs tracking',
        text: 'Enable optional bin-level storage per warehouse and trace batch country of origin and customs declaration details from goods receipt through shipment and print forms.',
        list: [
          'Optional per-warehouse bin hierarchy: zone, rack, shelf, and cell',
          'Real-time bin-level stock balances with placement, picking, and transfers between bins',
          'Batch country of origin and customs declaration number tracking across receipts, lots, and shipments',
          'Origin and customs fields carried automatically onto outbound documents and printable forms',
        ],
        screen: 'Warehouse bin hierarchy with bin-level stock balances and batch origin/customs tracking',
      },
      {
        title: 'Product kits (bundles) and landed cost allocation',
        text: 'Sell product bundles without creating production runs — component items deduct from stock automatically. Post freight, customs duty, and handling after receipt and revalue both on-hand stock and already-shipped items.',
        list: [
          'Product kits: define components in the catalog, auto-deduct/return components on shipment, and split revenue penny-accurately',
          'Landed Cost Voucher: attach to goods receipts and production outputs with a reference to the service vendor’s invoice',
          'Allocate landed costs by amount, quantity, weight, or manually with an itemized landed-cost report',
        ],
        screen: 'Product kits in catalog and landed cost allocation across receipts',
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
      ['Are warehouse bins and customs/origin tracking supported?', 'Yes. Bin/location storage (zone/rack/shelf/cell hierarchy, bin-level balances, placement, picking, and bin-to-bin transfers) can be enabled per warehouse. You can also track batch country of origin and customs declaration numbers across receipts, lots, shipments, and print forms.'],
    ],
  },
};
