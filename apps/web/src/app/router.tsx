import * as React from 'react';
import { Navigate, createHashRouter } from 'react-router';
import { useMyPrefs } from './data/settings';
import { AppShell } from './layout/AppShell';
import { HomePage } from './pages/HomePage';
import { DesignSystemPage } from './pages/DesignSystemPage';
import { InboxPage } from './pages/InboxPage';
import { MyTasksPage } from './pages/MyTasksPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { CalendarPage } from './pages/CalendarPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { OverviewPage } from './pages/OverviewPage';
import { TasksPage } from './pages/TasksPage';
import { ProjectPage } from './pages/ProjectPage';
import { TimelinePage } from './pages/TimelinePage';
import { ActivityPage } from './pages/ActivityPage';
import { MembersPage } from './pages/MembersPage';
import { MemberPage } from './pages/MemberPage';
import { SearchPage } from './pages/SearchPage';
import { ArchivePage } from './pages/ArchivePage';
import { TeamPage, TeamsPage } from './pages/TeamPage';
import { SettingsPage } from './pages/SettingsPage';
import { UpgradePage } from './licensing/UpgradePage';
import { NotFoundPage, PlaceholderPage } from './pages/PlaceholderPage';
import { ForgotPage, ResetPage, SignInPage, SignUpPage, VerifyPage } from './pages/AuthPages';
import { OnboardingPage } from './pages/OnboardingPage';
import { RequireAuth } from './layout/RequireAuth';
import { SECTIONS } from './routes';
import { CrmProvider } from './crm/store';
import { WorkspaceProvider } from './data/store';
import { DashboardPage as CrmDashboardPage } from './crm/DashboardPage';
import { DealsPage as CrmDealsPage } from './crm/DealsPage';
import { LeadsPage as CrmLeadsPage } from './leads/LeadsPage';
import { FunnelPage as CrmFunnelPage } from './crm/FunnelPage';
import { AdsPage as CrmAdsPage } from './crm/AdsPage';
import { CompaniesPage as CrmCompaniesPage } from './crm/CompaniesPage';
import { CompanyPage as CrmCompanyPage } from './crm/CompanyPage';
import { ContactsPage as CrmContactsPage } from './crm/ContactsPage';
import { ActivitiesPage as CrmActivitiesPage } from './crm/ActivitiesPage';
import { SalesPlanPage as CrmSalesPlanPage } from './crm/SalesPlanPage';
import { SalesPlanDocumentPage as CrmSalesPlanDocumentPage } from './crm/SalesPlanDocumentPage';
import { AppointmentsPage as CrmAppointmentsPage } from './crm/AppointmentsPage';
import { ServiceDayPage as CrmServiceDayPage } from './crm/ServiceDayPage';
import { RecordsPage } from './meta/RecordsPage';
import { CatalogPage } from './catalog/CatalogPage';
import { ItemPage } from './production/ItemPage';
import { ProductionPage } from './production/ProductionPage';
import { WorkCentersPage } from './production/WorkCentersPage';
import { ProductionOrdersPage } from './production/ProductionOrdersPage';
import { ProductionOrderPage } from './production/ProductionOrderPage';
import { ProductionStagesPage } from './production/ProductionStagesPage';
import { PieceworkPage } from './production/PieceworkPage';
import { ProductionWorkbenchPage } from './production/ProductionWorkbenchPage';
import { ProductionNeedsPage } from './production/ProductionNeedsPage';
import { ProductionPlansPage } from './production/ProductionPlansPage';
import { ProductionPlanPage } from './production/ProductionPlanPage';
import { PlanOrdersPage } from './production/PlanOrdersPage';
import { PlannerPage } from './production/PlannerPage';
import { ResourcesPage } from './production/ResourcesPage';
import { MonthClosingPage } from './production/MonthClosingPage';
import { WipBalancePage } from './production/WipBalancePage';
import { ProductionReportsPage } from './production/reports/ProductionReportsPage';
import { OtherCostsDocumentPage, OtherCostsPage } from './production/OtherCostsPage';
import { MaterialAllocationPage, MaterialAllocationsPage } from './production/MaterialAllocationPage';
import { InvestmentPage } from './finance/InvestmentPage';
import { InvestmentsPage } from './finance/InvestmentsPage';
import { MoneyPage } from './money/MoneyPage';
import { BankImportPage } from './money/BankImportPage';
import { PaymentPage } from './money/PaymentPage';
import { PaymentCalendarPage } from './money/CalendarPage';
import { RequestPage, RequestsPage } from './money/RequestPages';
import { OpeningPage, OpeningsPage } from './money/OpeningPages';
import { PriceKindsPage, PriceListPage, PriceSettingPage, PriceSettingsPage } from './pricing/PricingPages';
import { PublicPricePage } from './pricing/PublicPricePage';
import { QuoteTemplatesPage } from './docs/QuoteTemplatesPage';
import { PayrollPage, PayrollsPage, StatementPage, StatementsPage } from './payroll/PayrollPages';
import { EmployeesPage, PayrollReportsPage, PayslipPage } from './payroll/PayrollAdminPages';
import { BalancesPage, CashFlowPage, DebtsPage, MoneyReferencesPage } from './money/ReportPages';
import { PlanFactPage } from './finance/PlanFactPage';
import { JournalPage } from './docs/JournalPage';
import { WorkOrdersPage } from './docs/work-orders';
import { TimesheetPage } from './docs/timesheet';
import { ServicePlannerPage } from './docs/service-planner';
import { ServiceReportsPage } from './services/reports/ServiceReportsPage';
import { DocumentPage } from './docs/DocumentPage';
import { PrintPage } from './docs/PrintPage';
import { DeliveriesPage } from './services/deliveries/DeliveriesPage';
import { MyDeliveriesPage } from './services/deliveries/MyDeliveriesPage';
import { FleetPage } from './fleet/FleetPage';
import { VehiclesPage } from './fleet/VehiclesPage';
import { DriversPage } from './fleet/DriversPage';
import { DocumentsPage as FleetDocumentsPage } from './fleet/DocumentsPage';
import { WaybillsPage } from './fleet/WaybillsPage';
import { FuelPage } from './fleet/FuelPage';
import { ServicePage } from './fleet/ServicePage';
import { FinesPage } from './fleet/FinesPage';
import { TripsPage } from './trips/TripsPage';
import { DispatchPage } from './trips/DispatchPage';
import { InventoryPage } from './docs/InventoryPage';
import { InUsePage } from './docs/InUsePage';
import { SerialsPage } from './docs/SerialsPage';
import { RepairItemsPage } from './docs/RepairItemsPage';
import { ProcessingPage } from './docs/ProcessingPage';
import { ContractsPage, TariffPlansPage } from './docs/contracts';
import { BillingPage } from './docs/billing';
import { AutomationsPage } from './automations/AutomationsPage';
import { FlowEditorPage } from './automations/FlowEditorPage';

/* Hash-роутинг, как в оригинале: работает на любом статическом хостинге без настройки rewrite.
   Чтобы перенести раздел, замените PlaceholderPage на его компонент. */
const PORTED = new Set([SECTIONS.home, SECTIONS.inbox, SECTIONS.mytasks, SECTIONS.favorites, SECTIONS.notifications, SECTIONS.overview, SECTIONS.calendar, SECTIONS.projects, SECTIONS.tasks, SECTIONS.timeline, SECTIONS.activity, SECTIONS.members, SECTIONS.search, SECTIONS.archive, SECTIONS.crm, SECTIONS.crmLeads, SECTIONS.crmAds, SECTIONS.crmDeals, SECTIONS.crmFunnel, SECTIONS.crmCompanies, SECTIONS.crmContacts, SECTIONS.crmActivities, SECTIONS.crmSalesPlan, SECTIONS.crmAppointments, SECTIONS.catalog, SECTIONS.production, SECTIONS.productionOrders, SECTIONS.productionWorkbench, SECTIONS.productionStages, SECTIONS.workOrders, SECTIONS.serials, SECTIONS.repairItems, SECTIONS.servicesTimesheet, SECTIONS.servicesPlanner, SECTIONS.servicesReports, SECTIONS.workCenters, SECTIONS.sales, SECTIONS.purchases, SECTIONS.stockDocs, SECTIONS.processingDocs, SECTIONS.inventory, SECTIONS.inUse, SECTIONS.automations, SECTIONS.settings, SECTIONS.system, SECTIONS.productionPiecework, SECTIONS.productionPlanner, SECTIONS.productionResources, SECTIONS.contracts, SECTIONS.tariffPlans, SECTIONS.billing, SECTIONS.productionNeeds, SECTIONS.productionPlans, SECTIONS.productionPlanOrders, SECTIONS.productionClosing, SECTIONS.productionWip, SECTIONS.productionReports, SECTIONS.otherCosts, SECTIONS.deliveries, SECTIONS.myDeliveries, SECTIONS.fleet, SECTIONS.fleetVehicles, SECTIONS.fleetDrivers, SECTIONS.fleetDocuments, SECTIONS.fleetWaybills, SECTIONS.fleetFuel, SECTIONS.fleetService, SECTIONS.fleetFines, SECTIONS.trips, SECTIONS.dispatch].map(s => s.path));

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

export const router = createHashRouter([
  {
    // CRM-хранилище живёт над оболочкой: из него берут данные крошки в топбаре и пункт «New deal»
    element: (
      <RequireAuth>
        <WorkspaceProvider>
          <CrmProvider>
            <AppShell />
          </CrmProvider>
        </WorkspaceProvider>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <StartPage /> },
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
      { path: SECTIONS.settings.path, element: <SettingsPage /> },
      { path: `${SECTIONS.settings.path}/:section`, element: <SettingsPage /> },
      { path: SECTIONS.system.path, element: <DesignSystemPage /> },
      { path: SECTIONS.crm.path, element: <CrmDashboardPage /> },
      { path: SECTIONS.crmLeads.path, element: <CrmLeadsPage /> },
      { path: SECTIONS.crmAds.path, element: <CrmAdsPage /> },
      { path: SECTIONS.crmFunnel.path, element: <CrmFunnelPage /> },
      { path: SECTIONS.crmDeals.path, element: <CrmDealsPage /> },
      { path: SECTIONS.crmCompanies.path, element: <CrmCompaniesPage /> },
      { path: `${SECTIONS.crmCompanies.path}/:id/:tab?`, element: <CrmCompanyPage /> },
      { path: SECTIONS.crmContacts.path, element: <CrmContactsPage /> },
      { path: SECTIONS.crmActivities.path, element: <CrmActivitiesPage /> },
      { path: SECTIONS.crmSalesPlan.path, element: <CrmSalesPlanPage /> },
      { path: `${SECTIONS.crmSalesPlan.path}/:id`, element: <CrmSalesPlanDocumentPage /> },
      { path: SECTIONS.crmAppointments.path, element: <CrmAppointmentsPage /> },
      { path: SECTIONS.crmQuoteTemplates.path, element: <QuoteTemplatesPage /> },
      { path: `${SECTIONS.crmAppointments.path}/day/:id`, element: <CrmServiceDayPage /> },
      // Каталог и производство
      { path: `${SECTIONS.catalog.path}/:productId?`, element: <CatalogPage /> },
      { path: SECTIONS.production.path, element: <ProductionPage /> },
      { path: SECTIONS.workCenters.path, element: <WorkCentersPage /> },
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
      { path: `${SECTIONS.investments.path}/:id`, element: <InvestmentPage /> },
      { path: `${SECTIONS.production.path}/:id`, element: <ItemPage /> },
      // Документы продаж и закупок, склад
      { path: SECTIONS.sales.path, element: <JournalPage group="sales" /> },
      { path: SECTIONS.workOrders.path, element: <WorkOrdersPage /> },
      { path: SECTIONS.servicesTimesheet.path, element: <TimesheetPage /> },
      { path: SECTIONS.servicesPlanner.path, element: <ServicePlannerPage /> },
      { path: SECTIONS.servicesReports.path, element: <ServiceReportsPage /> },
      { path: SECTIONS.purchases.path, element: <JournalPage group="purchases" /> },
      { path: SECTIONS.stockDocs.path, element: <JournalPage group="stock" /> },
      { path: SECTIONS.processingDocs.path, element: <ProcessingPage /> },
      { path: '/documents/:id', element: <DocumentPage /> },
      { path: '/documents/:id/print/:form', element: <PrintPage /> },
      { path: `${SECTIONS.inventory.path}/:productId?`, element: <InventoryPage /> },
      { path: SECTIONS.inUse.path, element: <InUsePage /> },
      { path: SECTIONS.serials.path, element: <SerialsPage /> },
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
      { path: SECTIONS.dispatch.path, element: <DispatchPage /> },
      // Договоры и биллинг
      { path: SECTIONS.contracts.path, element: <ContractsPage /> },
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
    ],
  },
  // Экраны входа и онбординга живут вне оболочки
  // публичный прайс-лист по ссылке: без входа
  { path: '/p/price/:token', element: <PublicPricePage /> },
  { path: '/signin', element: <SignInPage /> },
  { path: '/signup', element: <SignUpPage /> },
  { path: '/forgot', element: <ForgotPage /> },
  { path: '/reset', element: <ResetPage /> },
  { path: '/verify', element: <VerifyPage /> },
  { path: '/onboarding', element: <OnboardingPage /> },
]);
