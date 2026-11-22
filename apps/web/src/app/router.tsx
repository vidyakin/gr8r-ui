import * as React from 'react';
import { Navigate, createHashRouter, type RouteObject } from 'react-router';
import { useMyPrefs } from './data/settings';
import { AppShell } from './layout/AppShell';
import { HomePage } from './pages/HomePage';
import { NotFoundPage, PlaceholderPage } from './pages/PlaceholderPage';
import { ForgotPage, ResetPage, SignInPage, SignUpPage, VerifyPage } from './pages/AuthPages';
import { RequireAuth } from './layout/RequireAuth';
import { SECTIONS } from './routes';
import { CrmProvider } from './crm/store';
import { WorkspaceProvider } from './data/store';

/** Экран грузится отдельным чанком при первом открытии: основной бандл держит только оболочку, «Главную» и вход
   (Lighthouse: LCP ждал разбора всего JS). Suspense — в рамке вкладки (layout/TabPages.tsx) и вокруг экранов вне оболочки. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyPage<K extends string>(load: () => Promise<Record<K, React.ComponentType<any>>>, name: K) {
  return React.lazy(() => load().then(m => ({ default: m[name] })));
}

const DesignSystemPage = lazyPage(() => import('./pages/DesignSystemPage'), 'DesignSystemPage');
const EmailPage = lazyPage(() => import('./email/EmailPage'), 'EmailPage');
const InboxPage = lazyPage(() => import('./pages/InboxPage'), 'InboxPage');
const MyTasksPage = lazyPage(() => import('./pages/MyTasksPage'), 'MyTasksPage');
const FavoritesPage = lazyPage(() => import('./pages/FavoritesPage'), 'FavoritesPage');
const CalendarPage = lazyPage(() => import('./pages/CalendarPage'), 'CalendarPage');
const ProjectsPage = lazyPage(() => import('./pages/ProjectsPage'), 'ProjectsPage');
const NotificationsPage = lazyPage(() => import('./pages/NotificationsPage'), 'NotificationsPage');
const OverviewPage = lazyPage(() => import('./pages/OverviewPage'), 'OverviewPage');
const TasksPage = lazyPage(() => import('./pages/TasksPage'), 'TasksPage');
const ProjectPage = lazyPage(() => import('./pages/ProjectPage'), 'ProjectPage');
const TimelinePage = lazyPage(() => import('./pages/TimelinePage'), 'TimelinePage');
const ActivityPage = lazyPage(() => import('./pages/ActivityPage'), 'ActivityPage');
const MembersPage = lazyPage(() => import('./pages/MembersPage'), 'MembersPage');
const MemberPage = lazyPage(() => import('./pages/MemberPage'), 'MemberPage');
const SearchPage = lazyPage(() => import('./pages/SearchPage'), 'SearchPage');
const ArchivePage = lazyPage(() => import('./pages/ArchivePage'), 'ArchivePage');
const TeamPage = lazyPage(() => import('./pages/TeamPage'), 'TeamPage');
const TeamsPage = lazyPage(() => import('./pages/TeamPage'), 'TeamsPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const UpgradePage = lazyPage(() => import('./licensing/UpgradePage'), 'UpgradePage');
const ChangelogPage = lazyPage(() => import('./changelog/ChangelogPage'), 'ChangelogPage');
const OnboardingPage = lazyPage(() => import('./pages/OnboardingPage'), 'OnboardingPage');
const JoinPage = lazyPage(() => import('./pages/JoinPage'), 'JoinPage');
const CrmDashboardPage = lazyPage(() => import('./crm/DashboardPage'), 'DashboardPage');
const CrmDealsPage = lazyPage(() => import('./crm/DealsPage'), 'DealsPage');
const CrmLeadsPage = lazyPage(() => import('./leads/LeadsPage'), 'LeadsPage');
const CrmCasesPage = lazyPage(() => import('./cases/CasesPage'), 'CasesPage');
const CrmAiChatsPage = lazyPage(() => import('./crm/AiChatsPage'), 'AiChatsPage');
const CrmFunnelPage = lazyPage(() => import('./crm/FunnelPage'), 'FunnelPage');
const CrmAdsPage = lazyPage(() => import('./crm/AdsPage'), 'AdsPage');
const CrmCompaniesPage = lazyPage(() => import('./crm/CompaniesPage'), 'CompaniesPage');
const CrmCompanyPage = lazyPage(() => import('./crm/CompanyPage'), 'CompanyPage');
const CrmContactsPage = lazyPage(() => import('./crm/ContactsPage'), 'ContactsPage');
const CrmActivitiesPage = lazyPage(() => import('./crm/ActivitiesPage'), 'ActivitiesPage');
const CrmSalesPlanPage = lazyPage(() => import('./crm/SalesPlanPage'), 'SalesPlanPage');
const CrmSalesPlanDocumentPage = lazyPage(() => import('./crm/SalesPlanDocumentPage'), 'SalesPlanDocumentPage');
const CrmAppointmentsPage = lazyPage(() => import('./crm/AppointmentsPage'), 'AppointmentsPage');
const CrmServiceDayPage = lazyPage(() => import('./crm/ServiceDayPage'), 'ServiceDayPage');
const RecordsPage = lazyPage(() => import('./meta/RecordsPage'), 'RecordsPage');
const CatalogPage = lazyPage(() => import('./catalog/CatalogPage'), 'CatalogPage');
const ItemPage = lazyPage(() => import('./production/ItemPage'), 'ItemPage');
const ProductionPage = lazyPage(() => import('./production/ProductionPage'), 'ProductionPage');
const WorkCentersPage = lazyPage(() => import('./production/WorkCentersPage'), 'WorkCentersPage');
const DefectReasonsPage = lazyPage(() => import('./production/DefectReasonsPage'), 'DefectReasonsPage');
const ProductionOrdersPage = lazyPage(() => import('./production/ProductionOrdersPage'), 'ProductionOrdersPage');
const ProductionOrderPage = lazyPage(() => import('./production/ProductionOrderPage'), 'ProductionOrderPage');
const ProductionStagesPage = lazyPage(() => import('./production/ProductionStagesPage'), 'ProductionStagesPage');
const PieceworkPage = lazyPage(() => import('./production/PieceworkPage'), 'PieceworkPage');
const ProductionWorkbenchPage = lazyPage(() => import('./production/ProductionWorkbenchPage'), 'ProductionWorkbenchPage');
const ProductionNeedsPage = lazyPage(() => import('./production/ProductionNeedsPage'), 'ProductionNeedsPage');
const ProductionPlansPage = lazyPage(() => import('./production/ProductionPlansPage'), 'ProductionPlansPage');
const ProductionPlanPage = lazyPage(() => import('./production/ProductionPlanPage'), 'ProductionPlanPage');
const PlanOrdersPage = lazyPage(() => import('./production/PlanOrdersPage'), 'PlanOrdersPage');
const PlannerPage = lazyPage(() => import('./production/PlannerPage'), 'PlannerPage');
const ResourcesPage = lazyPage(() => import('./production/ResourcesPage'), 'ResourcesPage');
const MonthClosingPage = lazyPage(() => import('./production/MonthClosingPage'), 'MonthClosingPage');
const WipBalancePage = lazyPage(() => import('./production/WipBalancePage'), 'WipBalancePage');
const ProductionReportsPage = lazyPage(() => import('./production/reports/ProductionReportsPage'), 'ProductionReportsPage');
const OtherCostsDocumentPage = lazyPage(() => import('./production/OtherCostsPage'), 'OtherCostsDocumentPage');
const OtherCostsPage = lazyPage(() => import('./production/OtherCostsPage'), 'OtherCostsPage');
const MaterialAllocationPage = lazyPage(() => import('./production/MaterialAllocationPage'), 'MaterialAllocationPage');
const MaterialAllocationsPage = lazyPage(() => import('./production/MaterialAllocationPage'), 'MaterialAllocationsPage');
const InvestmentPage = lazyPage(() => import('./finance/InvestmentPage'), 'InvestmentPage');
const InvestmentsPage = lazyPage(() => import('./finance/InvestmentsPage'), 'InvestmentsPage');
const ObjectPage = lazyPage(() => import('./objects/ObjectPage'), 'ObjectPage');
const ObjectsPage = lazyPage(() => import('./objects/ObjectsPage'), 'ObjectsPage');
const ObjectsForecastPage = lazyPage(() => import('./objects/ObjectsForecastPage'), 'ObjectsForecastPage');
const ShiftPage = lazyPage(() => import('./shifts/ShiftPage'), 'ShiftPage');
const MoneyPage = lazyPage(() => import('./money/MoneyPage'), 'MoneyPage');
const BankImportPage = lazyPage(() => import('./money/BankImportPage'), 'BankImportPage');
const PaymentPage = lazyPage(() => import('./money/PaymentPage'), 'PaymentPage');
const PaymentCalendarPage = lazyPage(() => import('./money/CalendarPage'), 'PaymentCalendarPage');
const RequestPage = lazyPage(() => import('./money/RequestPages'), 'RequestPage');
const RequestsPage = lazyPage(() => import('./money/RequestPages'), 'RequestsPage');
const OpeningPage = lazyPage(() => import('./money/OpeningPages'), 'OpeningPage');
const OpeningsPage = lazyPage(() => import('./money/OpeningPages'), 'OpeningsPage');
const DiscountRulesPage = lazyPage(() => import('./loyalty/LoyaltyPages'), 'DiscountRulesPage');
const LoyaltyCardPage = lazyPage(() => import('./loyalty/LoyaltyPages'), 'LoyaltyCardPage');
const LoyaltyCardsPage = lazyPage(() => import('./loyalty/LoyaltyPages'), 'LoyaltyCardsPage');
const LoyaltyProgramPage = lazyPage(() => import('./loyalty/LoyaltyPages'), 'LoyaltyProgramPage');
const PromoCodesPage = lazyPage(() => import('./loyalty/LoyaltyPages'), 'PromoCodesPage');
const PriceKindsPage = lazyPage(() => import('./pricing/PricingPages'), 'PriceKindsPage');
const PriceListPage = lazyPage(() => import('./pricing/PricingPages'), 'PriceListPage');
const PriceSettingPage = lazyPage(() => import('./pricing/PricingPages'), 'PriceSettingPage');
const PriceSettingsPage = lazyPage(() => import('./pricing/PricingPages'), 'PriceSettingsPage');
const PublicPricePage = lazyPage(() => import('./pricing/PublicPricePage'), 'PublicPricePage');
const SupplierPricePage = lazyPage(() => import('./pricing/supplier-price-page'), 'SupplierPricePage');
const QuoteTemplatesPage = lazyPage(() => import('./docs/QuoteTemplatesPage'), 'QuoteTemplatesPage');
const PayrollPage = lazyPage(() => import('./payroll/PayrollPages'), 'PayrollPage');
const PayrollsPage = lazyPage(() => import('./payroll/PayrollPages'), 'PayrollsPage');
const StatementPage = lazyPage(() => import('./payroll/PayrollPages'), 'StatementPage');
const StatementsPage = lazyPage(() => import('./payroll/PayrollPages'), 'StatementsPage');
const EmployeesPage = lazyPage(() => import('./payroll/PayrollAdminPages'), 'EmployeesPage');
const PayrollReportsPage = lazyPage(() => import('./payroll/PayrollAdminPages'), 'PayrollReportsPage');
const PayslipPage = lazyPage(() => import('./payroll/PayrollAdminPages'), 'PayslipPage');
const BalancesPage = lazyPage(() => import('./money/ReportPages'), 'BalancesPage');
const CashFlowPage = lazyPage(() => import('./money/ReportPages'), 'CashFlowPage');
const DebtsPage = lazyPage(() => import('./money/ReportPages'), 'DebtsPage');
const MoneyReferencesPage = lazyPage(() => import('./money/ReportPages'), 'MoneyReferencesPage');
const PlanFactPage = lazyPage(() => import('./finance/PlanFactPage'), 'PlanFactPage');
const JournalPage = lazyPage(() => import('./docs/JournalPage'), 'JournalPage');
const SupplierRatingsPage = lazyPage(() => import('./docs/SupplierRatingsPage'), 'SupplierRatingsPage');
const WorkOrdersPage = lazyPage(() => import('./docs/work-orders'), 'WorkOrdersPage');
const TimesheetPage = lazyPage(() => import('./docs/timesheet'), 'TimesheetPage');
const ServicePlannerPage = lazyPage(() => import('./docs/service-planner'), 'ServicePlannerPage');
const ServiceReportsPage = lazyPage(() => import('./services/reports/ServiceReportsPage'), 'ServiceReportsPage');
const DocumentPage = lazyPage(() => import('./docs/DocumentPage'), 'DocumentPage');
const PrintPage = lazyPage(() => import('./docs/PrintPage'), 'PrintPage');
const ContractPrintPage = lazyPage(() => import('./docs/ContractPrintPage'), 'ContractPrintPage');
const DeliveriesPage = lazyPage(() => import('./services/deliveries/DeliveriesPage'), 'DeliveriesPage');
const MyDeliveriesPage = lazyPage(() => import('./services/deliveries/MyDeliveriesPage'), 'MyDeliveriesPage');
const FleetPage = lazyPage(() => import('./fleet/FleetPage'), 'FleetPage');
const VehiclesPage = lazyPage(() => import('./fleet/VehiclesPage'), 'VehiclesPage');
const DriversPage = lazyPage(() => import('./fleet/DriversPage'), 'DriversPage');
const FleetDocumentsPage = lazyPage(() => import('./fleet/DocumentsPage'), 'DocumentsPage');
const WaybillsPage = lazyPage(() => import('./fleet/WaybillsPage'), 'WaybillsPage');
const FuelPage = lazyPage(() => import('./fleet/FuelPage'), 'FuelPage');
const ServicePage = lazyPage(() => import('./fleet/ServicePage'), 'ServicePage');
const FinesPage = lazyPage(() => import('./fleet/FinesPage'), 'FinesPage');
const DriverPage = lazyPage(() => import('./driver/DriverPage'), 'DriverPage');
const TripsPage = lazyPage(() => import('./trips/TripsPage'), 'TripsPage');
const DispatchPage = lazyPage(() => import('./trips/DispatchPage'), 'DispatchPage');
const TransportOrdersPage = lazyPage(() => import('./transport-orders/TransportOrdersPage'), 'TransportOrdersPage');
const RateSchedulesPage = lazyPage(() => import('./transport-orders/RateSchedulesPage'), 'RateSchedulesPage');
const InventoryPage = lazyPage(() => import('./docs/InventoryPage'), 'InventoryPage');
const InUsePage = lazyPage(() => import('./docs/InUsePage'), 'InUsePage');
const SerialsPage = lazyPage(() => import('./docs/SerialsPage'), 'SerialsPage');
const BatchesPage = lazyPage(() => import('./docs/BatchesPage'), 'BatchesPage');
const StockAgingPage = lazyPage(() => import('./docs/StockAgingPage'), 'StockAgingPage');
const RepairItemsPage = lazyPage(() => import('./docs/RepairItemsPage'), 'RepairItemsPage');
const ProcessingPage = lazyPage(() => import('./docs/ProcessingPage'), 'ProcessingPage');
const ContractsPage = lazyPage(() => import('./docs/contracts'), 'ContractsPage');
const TariffPlansPage = lazyPage(() => import('./docs/contracts'), 'TariffPlansPage');
const ApprovalsPage = lazyPage(() => import('./approvals/ApprovalsPage'), 'ApprovalsPage');
const BillingPage = lazyPage(() => import('./docs/billing'), 'BillingPage');
const AutomationsPage = lazyPage(() => import('./automations/AutomationsPage'), 'AutomationsPage');
const FlowEditorPage = lazyPage(() => import('./automations/FlowEditorPage'), 'FlowEditorPage');

/* Hash-роутинг, как в оригинале: работает на любом статическом хостинге без настройки rewrite.
   Чтобы перенести раздел, замените PlaceholderPage на его компонент. */
const PORTED = new Set([SECTIONS.home, SECTIONS.email, SECTIONS.inbox, SECTIONS.mytasks, SECTIONS.favorites, SECTIONS.notifications, SECTIONS.overview, SECTIONS.calendar, SECTIONS.projects, SECTIONS.tasks, SECTIONS.timeline, SECTIONS.activity, SECTIONS.members, SECTIONS.search, SECTIONS.archive, SECTIONS.crm, SECTIONS.crmLeads, SECTIONS.crmCases, SECTIONS.crmAiChats, SECTIONS.crmAds, SECTIONS.crmDeals, SECTIONS.crmFunnel, SECTIONS.crmCompanies, SECTIONS.crmContacts, SECTIONS.crmActivities, SECTIONS.crmSalesPlan, SECTIONS.crmAppointments, SECTIONS.catalog, SECTIONS.production, SECTIONS.productionOrders, SECTIONS.productionWorkbench, SECTIONS.suppliers, SECTIONS.productionStages, SECTIONS.workOrders, SECTIONS.serials, SECTIONS.batches, SECTIONS.stockAging, SECTIONS.repairItems, SECTIONS.servicesTimesheet, SECTIONS.servicesPlanner, SECTIONS.servicesReports, SECTIONS.workCenters, SECTIONS.defectReasons, SECTIONS.sales, SECTIONS.purchases, SECTIONS.supplierRatings, SECTIONS.stockDocs, SECTIONS.processingDocs, SECTIONS.inventory, SECTIONS.inUse, SECTIONS.automations, SECTIONS.settings, SECTIONS.system, SECTIONS.productionPiecework, SECTIONS.productionPlanner, SECTIONS.productionResources, SECTIONS.contracts, SECTIONS.approvals, SECTIONS.tariffPlans, SECTIONS.billing, SECTIONS.productionNeeds, SECTIONS.productionPlans, SECTIONS.productionPlanOrders, SECTIONS.productionClosing, SECTIONS.productionWip, SECTIONS.productionReports, SECTIONS.otherCosts, SECTIONS.deliveries, SECTIONS.myDeliveries, SECTIONS.fleet, SECTIONS.fleetVehicles, SECTIONS.fleetDrivers, SECTIONS.fleetDocuments, SECTIONS.fleetWaybills, SECTIONS.fleetFuel, SECTIONS.fleetService, SECTIONS.fleetFines, SECTIONS.trips, SECTIONS.transportOrders, SECTIONS.rateSchedules, SECTIONS.dispatch, SECTIONS.driverWorkplace, SECTIONS.objects, SECTIONS.objectsForecast, SECTIONS.shift].map(s => s.path));

/** Личная настройка «Открывать при запуске»: один раз за загрузку приложения корень `/` ведёт на выбранный раздел, дальше — обычная «Главная» */
let startHandled = false;
function StartPage() {
  const { home } = useMyPrefs();
  const [redirect] = React.useState(() => !startHandled && home !== 'home');
  React.useEffect(() => {
    startHandled = true;
  }, []);
  return redirect ? <Navigate to={home === 'inbox' ? SECTIONS.inbox.path : SECTIONS.mytasks.path} replace /> : <HomePage />;
}

/* Страницы оболочки. Роутер сопоставляет по ним адрес (крошки, handle), а рисует их AppShell — каждую открытую вкладку
   со своим адресом (layout/TabPages.tsx). handle.pageKey — ключ вкладки и страницы; handle.keepAlive: false — вкладка
   не остаётся живой в фоне и выгружается при уходе (тяжёлые страницы, у их запросов gcTime: 0). */
const shellPages: RouteObject[] = [
  { index: true, element: <StartPage /> },
  { path: SECTIONS.email.path, element: <EmailPage /> },
  { path: SECTIONS.inbox.path, element: <InboxPage /> },
  { path: SECTIONS.mytasks.path, element: <MyTasksPage /> },
  { path: SECTIONS.favorites.path, element: <FavoritesPage /> },
  { path: SECTIONS.notifications.path, element: <NotificationsPage /> },
  { path: SECTIONS.overview.path, element: <OverviewPage /> },
  { path: SECTIONS.calendar.path, element: <CalendarPage /> },
  { path: SECTIONS.projects.path, element: <ProjectsPage /> },
  { path: SECTIONS.tasks.path, element: <TasksPage /> },
  { path: SECTIONS.timeline.path, element: <TimelinePage /> },
  { path: SECTIONS.activity.path, element: <ActivityPage /> },
  { path: SECTIONS.members.path, element: <MembersPage /> },
  { path: `${SECTIONS.members.path}/:id`, element: <MemberPage /> },
  { path: SECTIONS.search.path, element: <SearchPage /> },
  { path: SECTIONS.archive.path, element: <ArchivePage /> },
  { path: SECTIONS.upgrade.path, element: <UpgradePage /> },
  { path: SECTIONS.changelog.path, element: <ChangelogPage /> },
  { path: SECTIONS.settings.path, element: <SettingsPage /> },
  { path: `${SECTIONS.settings.path}/:section`, element: <SettingsPage /> },
  { path: SECTIONS.system.path, element: <DesignSystemPage /> },
  { path: SECTIONS.crm.path, element: <CrmDashboardPage /> },
  { path: SECTIONS.crmLeads.path, element: <CrmLeadsPage /> },
  { path: SECTIONS.crmCases.path, element: <CrmCasesPage /> },
  { path: `${SECTIONS.crmCases.path}/:id`, element: <CrmCasesPage /> },
  { path: SECTIONS.crmAiChats.path, element: <CrmAiChatsPage /> },
  { path: SECTIONS.crmAds.path, element: <CrmAdsPage /> },
  { path: SECTIONS.crmFunnel.path, element: <CrmFunnelPage /> },
  { path: SECTIONS.crmDeals.path, element: <CrmDealsPage /> },
  { path: SECTIONS.crmCompanies.path, element: <CrmCompaniesPage /> },
  { path: `${SECTIONS.crmCompanies.path}/:id/prices/:priceId`, element: <SupplierPricePage />, handle: { keepAlive: false } },
  { path: `${SECTIONS.crmCompanies.path}/:id/:tab?`, element: <CrmCompanyPage /> },
  { path: SECTIONS.crmContacts.path, element: <CrmContactsPage /> },
  { path: SECTIONS.crmActivities.path, element: <CrmActivitiesPage /> },
  { path: SECTIONS.crmSalesPlan.path, element: <CrmSalesPlanPage /> },
  { path: `${SECTIONS.crmSalesPlan.path}/:id`, element: <CrmSalesPlanDocumentPage /> },
  { path: SECTIONS.crmAppointments.path, element: <CrmAppointmentsPage /> },
  { path: SECTIONS.crmQuoteTemplates.path, element: <QuoteTemplatesPage /> },
  { path: `${SECTIONS.crmAppointments.path}/day/:id`, element: <CrmServiceDayPage /> },
  // Каталог и производство
  // handle.pageKey: открытие карточки товара (смена :productId) не пересоздаёт страницу — таблица не моргает
  { path: `${SECTIONS.catalog.path}/:productId?`, element: <CatalogPage />, handle: { pageKey: SECTIONS.catalog.path } },
  { path: SECTIONS.production.path, element: <ProductionPage /> },
  { path: SECTIONS.workCenters.path, element: <WorkCentersPage /> },
  { path: SECTIONS.defectReasons.path, element: <DefectReasonsPage /> },
  { path: SECTIONS.suppliers.path, element: <CrmCompaniesPage role="supplier" /> },
  { path: SECTIONS.productionOrders.path, element: <ProductionOrdersPage /> },
  { path: `${SECTIONS.productionOrders.path}/:id`, element: <ProductionOrderPage /> },
  { path: SECTIONS.productionWorkbench.path, element: <ProductionWorkbenchPage /> },
  { path: SECTIONS.productionNeeds.path, element: <ProductionNeedsPage /> },
  { path: SECTIONS.productionPlans.path, element: <ProductionPlansPage /> },
  { path: `${SECTIONS.productionPlans.path}/:id`, element: <ProductionPlanPage /> },
  { path: SECTIONS.productionPlanOrders.path, element: <PlanOrdersPage /> },
  { path: SECTIONS.productionStages.path, element: <ProductionStagesPage /> },
  { path: SECTIONS.productionPiecework.path, element: <PieceworkPage /> },
  { path: SECTIONS.productionPlanner.path, element: <PlannerPage /> },
  { path: SECTIONS.productionResources.path, element: <ResourcesPage /> },
  { path: SECTIONS.productionClosing.path, element: <MonthClosingPage /> },
  { path: SECTIONS.productionWip.path, element: <WipBalancePage /> },
  { path: SECTIONS.productionReports.path, element: <ProductionReportsPage /> },
  { path: SECTIONS.otherCosts.path, element: <OtherCostsPage /> },
  { path: `${SECTIONS.otherCosts.path}/:id`, element: <OtherCostsDocumentPage /> },
  { path: SECTIONS.materialAllocation.path, element: <MaterialAllocationsPage /> },
  { path: `${SECTIONS.materialAllocation.path}/:id`, element: <MaterialAllocationPage /> },
  // Финансы: деньги
  { path: SECTIONS.money.path, element: <MoneyPage /> },
  { path: SECTIONS.moneyCalendar.path, element: <PaymentCalendarPage /> },
  { path: SECTIONS.moneyRequests.path, element: <RequestsPage /> },
  { path: `${SECTIONS.moneyRequests.path}/:id`, element: <RequestPage /> },
  { path: SECTIONS.moneyOpening.path, element: <OpeningsPage /> },
  { path: `${SECTIONS.moneyOpening.path}/:id`, element: <OpeningPage /> },
  { path: SECTIONS.priceList.path, element: <PriceListPage /> },
  { path: SECTIONS.priceSettings.path, element: <PriceSettingsPage /> },
  { path: `${SECTIONS.priceSettings.path}/:id`, element: <PriceSettingPage /> },
  { path: SECTIONS.priceKinds.path, element: <PriceKindsPage /> },
  { path: SECTIONS.discountRules.path, element: <DiscountRulesPage /> },
  { path: SECTIONS.promoCodes.path, element: <PromoCodesPage /> },
  { path: SECTIONS.loyaltyCards.path, element: <LoyaltyCardsPage /> },
  { path: `${SECTIONS.loyaltyCards.path}/:id`, element: <LoyaltyCardPage /> },
  { path: SECTIONS.loyaltyProgram.path, element: <LoyaltyProgramPage /> },
  { path: SECTIONS.payroll.path, element: <PayrollsPage /> },
  { path: SECTIONS.payrollStatements.path, element: <StatementsPage /> },
  { path: `${SECTIONS.payrollStatements.path}/:id`, element: <StatementPage /> },
  { path: SECTIONS.payrollEmployees.path, element: <EmployeesPage /> },
  { path: SECTIONS.payrollReports.path, element: <PayrollReportsPage /> },
  { path: SECTIONS.payslip.path, element: <PayslipPage /> },
  { path: `${SECTIONS.payroll.path}/:id`, element: <PayrollPage /> },
  { path: SECTIONS.moneyBalances.path, element: <BalancesPage /> },
  { path: SECTIONS.moneyCashFlow.path, element: <CashFlowPage /> },
  { path: SECTIONS.moneyReceivables.path, element: <DebtsPage side="customer" /> },
  { path: SECTIONS.moneyPayables.path, element: <DebtsPage side="supplier" /> },
  { path: SECTIONS.moneyBankImport.path, element: <BankImportPage /> },
  { path: SECTIONS.moneyReferences.path, element: <MoneyReferencesPage /> },
  { path: `${SECTIONS.money.path}/:id`, element: <PaymentPage /> },
  // Финансы: инвестпроекты
  { path: SECTIONS.investments.path, element: <InvestmentsPage /> },
  { path: SECTIONS.investmentsPlanFact.path, element: <PlanFactPage /> },
  // Объектный учёт
  { path: SECTIONS.objects.path, element: <ObjectsPage /> },
  // прогноз прибыли по всем активным объектам (задача 1275) — до карточки объекта: /objects/forecast
  { path: SECTIONS.objectsForecast.path, element: <ObjectsForecastPage /> },
  { path: `${SECTIONS.objects.path}/:id`, element: <ObjectPage /> },
  // Смена прораба (задача 1271): выбор объекта и даты и сама смена
  { path: SECTIONS.shift.path, element: <ShiftPage /> },
  { path: `${SECTIONS.shift.path}/:id`, element: <ShiftPage /> },
  { path: `${SECTIONS.investments.path}/:id`, element: <InvestmentPage /> },
  { path: `${SECTIONS.production.path}/:id`, element: <ItemPage /> },
  // Документы продаж и закупок, склад
  { path: SECTIONS.sales.path, element: <JournalPage group="sales" /> },
  { path: SECTIONS.workOrders.path, element: <WorkOrdersPage /> },
  { path: SECTIONS.servicesTimesheet.path, element: <TimesheetPage /> },
  { path: SECTIONS.servicesPlanner.path, element: <ServicePlannerPage /> },
  { path: SECTIONS.servicesReports.path, element: <ServiceReportsPage /> },
  { path: SECTIONS.purchases.path, element: <JournalPage group="purchases" /> },
  { path: SECTIONS.supplierRatings.path, element: <SupplierRatingsPage /> },
  { path: SECTIONS.stockDocs.path, element: <JournalPage group="stock" /> },
  { path: SECTIONS.processingDocs.path, element: <ProcessingPage /> },
  { path: '/documents/:id', element: <DocumentPage /> },
  { path: '/documents/:id/print/:form', element: <PrintPage /> },
  { path: `${SECTIONS.inventory.path}/:productId?`, element: <InventoryPage />, handle: { pageKey: SECTIONS.inventory.path } },
  { path: SECTIONS.inUse.path, element: <InUsePage /> },
  { path: SECTIONS.serials.path, element: <SerialsPage /> },
  { path: SECTIONS.batches.path, element: <BatchesPage /> },
  { path: SECTIONS.stockAging.path, element: <StockAgingPage /> },
  { path: SECTIONS.repairItems.path, element: <RepairItemsPage /> },
  { path: SECTIONS.deliveries.path, element: <DeliveriesPage /> },
  { path: SECTIONS.myDeliveries.path, element: <MyDeliveriesPage /> },
  { path: SECTIONS.fleet.path, element: <FleetPage /> },
  { path: SECTIONS.fleetVehicles.path, element: <VehiclesPage /> },
  { path: SECTIONS.fleetDrivers.path, element: <DriversPage /> },
  { path: SECTIONS.fleetDocuments.path, element: <FleetDocumentsPage /> },
  { path: SECTIONS.fleetWaybills.path, element: <WaybillsPage /> },
  { path: SECTIONS.fleetFuel.path, element: <FuelPage /> },
  { path: SECTIONS.fleetService.path, element: <ServicePage /> },
  { path: SECTIONS.fleetFines.path, element: <FinesPage /> },
  { path: SECTIONS.trips.path, element: <TripsPage /> },
  { path: SECTIONS.transportOrders.path, element: <TransportOrdersPage /> },
  { path: SECTIONS.rateSchedules.path, element: <RateSchedulesPage /> },
  { path: SECTIONS.driverWorkplace.path, element: <DriverPage /> },
  { path: SECTIONS.dispatch.path, element: <DispatchPage /> },
  // Договоры и биллинг
  { path: SECTIONS.contracts.path, element: <ContractsPage /> },
  { path: SECTIONS.approvals.path, element: <ApprovalsPage /> },
  { path: '/contracts/:id/print', element: <ContractPrintPage /> },
  { path: SECTIONS.tariffPlans.path, element: <TariffPlansPage /> },
  { path: SECTIONS.billing.path, element: <BillingPage /> },
  // Автоматизации: список и журнал, редактор flow
  { path: SECTIONS.automations.path, element: <AutomationsPage /> },
  { path: `${SECTIONS.automations.path}/runs`, element: <AutomationsPage /> },
  { path: `${SECTIONS.automations.path}/flow/:id/:tab?`, element: <FlowEditorPage /> },
  // Свои сущности конструктора: экран собирается из метаданных
  { path: '/data/:key/:recordId?', element: <RecordsPage /> },
  // Разделы, которые ещё не перенесены, открывают заглушку
  ...Object.values(SECTIONS)
    .filter(s => !PORTED.has(s.path))
    .map(s => ({ path: s.path, element: <PlaceholderPage /> })),
  { path: '/projects/:id/:tab?', element: <ProjectPage /> },
  { path: '/teams', element: <TeamsPage /> },
  { path: '/teams/:id', element: <TeamPage /> },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createHashRouter([
  {
    // CRM-хранилище живёт над оболочкой: из него берут данные крошки в топбаре и пункт «New deal»
    element: (
      <RequireAuth>
        <WorkspaceProvider>
          <CrmProvider>
            <AppShell pages={shellPages} />
          </CrmProvider>
        </WorkspaceProvider>
      </RequireAuth>
    ),
    children: shellPages,
  },
  // Экраны входа и онбординга живут вне оболочки
  // публичный прайс-лист по ссылке: без входа
  { path: '/p/price/:token', element: <React.Suspense fallback={null}><PublicPricePage /></React.Suspense> },
  { path: '/signin', element: <SignInPage /> },
  { path: '/signup', element: <SignUpPage /> },
  { path: '/forgot', element: <ForgotPage /> },
  { path: '/reset', element: <ResetPage /> },
  { path: '/verify', element: <VerifyPage /> },
  { path: '/onboarding', element: <React.Suspense fallback={null}><OnboardingPage /></React.Suspense> },
  { path: '/join/:token', element: <React.Suspense fallback={null}><JoinPage /></React.Suspense> },
]);
