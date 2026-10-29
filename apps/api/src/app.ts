/* Сборка приложения Hono. createApp({ sql }) принимает зависимости, поэтому тесты поднимают его на тестовой БД без порта. */
import { and, eq, gt } from 'drizzle-orm';
import { Hono } from 'hono';
import { getConnInfo, upgradeWebSocket, websocket } from 'hono/bun';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { databaseUrl, events, isUuid, memberships, members, withContext, type Sql } from '@gr8r/db';
import { adminRoutes } from './admin';
import { authRoutes } from './auth';
import { loadConfig } from './env';
import { AppError, dbUnavailable, forbidden, onError, onNotFound } from './errors';
import { requireSession, requestLogger, tenant } from './middleware';
import { Hub } from './realtime';
import { attributeRoutes, categoryRoutes, productRoutes, unitRoutes, variantRoutes } from './routes/catalog';
import { bomLineRoutes, itemRoutes, productionRoutes, workCenterRoutes } from './routes/production';
import { productionOrderRoutes } from './routes/production-orders';
import { productionPlanRoutes } from './routes/production-plans';
import { stockLevelRoutes } from './routes/stock-levels';
import { pieceworkRoutes, operationAssignmentRoutes } from './routes/piecework';
import { productionStageRoutes } from './routes/production-stages';
import { productionReportRoutes } from './routes/production-reports';
import { planningRoutes } from './routes/planning';
import { productionWorkbenchRoutes } from './routes/production-workbench';
import { companyRoutes, contactRoutes, crmActivityRoutes, dealRoutes } from './routes/crm';
import { bankAccountRoutes, companyBankRoutes, costItemRoutes, documentRoutes, organizationBankRoutes, organizationRoutes, stockRoutes, warehouseRoutes } from './routes/documents';
import { componentOwnerRoutes, processorReportRoutes, processorTransferRoutes, tollingRoutes } from './routes/tolling';
import { documentStateRoutes, workOrderAssignmentRoutes, workOrderKindRoutes, workOrderRoutes } from './routes/work-orders';
import { serviceReportRoutes } from './routes/service-reports';
import { salesPlanRoutes } from './routes/sales-plan';
import { appointmentRoutes } from './routes/appointments';
import { repairItemRoutes, serialRoutes } from './routes/serials';
import { deliveryMethodRoutes, deliveryRoutes } from './routes/delivery';
import { positionRoutes, productKindRoutes } from './routes/positions';
import { secretRoutes } from './routes/secrets';
import { bankConnectionRoutes, paymentLinkRoutes } from './routes/integrations';
import { serviceRoutes } from './routes/services';
import { contractRoutes, tariffPlanRoutes } from './routes/contracts';
import { billingRoutes } from './routes/billing';
import { calculationRoutes } from './routes/calculations';
import { materialAllocationRoutes, otherCostsRoutes, productionClosingRoutes } from './routes/production-closing';
import { investmentRoutes } from './routes/investments';
import { cashFlowItemRoutes, cashRegisterRoutes, paymentRoutes } from './routes/payments';
import { paymentCalendarRoutes, paymentRequestRoutes } from './routes/payment-calendar';
import { openingBalanceRoutes } from './routes/opening-balances';
import { payrollRoutes } from './routes/payroll';
import { pricingRoutes } from './routes/pricing';
import { docTemplateRoutes } from './routes/doc-templates';
import { bankImportRoutes } from './routes/bank-import';
import { flowRoutes, flowRunRoutes } from './routes/flows';
import { hookRoutes } from './routes/hooks';
import { leadFormRoutes, leadRoutes, leadStatusRoutes } from './routes/leads';
import { adCampaignRoutes, adExpenseRoutes, adReportRoutes, leadSourceRoutes } from './routes/ad';
import { entityRoutes } from './routes/meta';
import { dataSearchRoutes, recordsRoutes } from './routes/records';
import {
  activityRoutes,
  calendarEventRoutes,
  commentRoutes,
  eventRoutes,
  fileRoutes,
  memberRoutes,
  notificationRoutes,
  projectRoutes,
  savedViewRoutes,
  statusRoutes,
  taskRoutes,
  teamRoutes,
  timeLogRoutes,
} from './routes/work';
import type { AppConfig, AppEnv } from './types';
import { inviteRoutes, workspaceRoutes } from './workspaces';

export { websocket };

const HEALTH_TIMEOUT_MS = 2000;

export interface AppDeps {
  sql: Sql;
  config?: Partial<AppConfig>;
  hub?: Hub;
}

/** Ресурсы арендатора: каждый путь защищён цепочкой «сессия → членство → транзакция с RLS» */
const TENANT_PATHS = ['/projects', '/statuses', '/tasks', '/comments', '/time-logs', '/notifications', '/members', '/teams', '/saved-views', '/calendar-events', '/files', '/activity', '/events', '/companies', '/contacts', '/deals', '/crm-activities', '/entities', '/data', '/data-search', '/units', '/product-categories', '/attribute-defs', '/products', '/work-centers', '/manufactured-items', '/bom-lines', '/production', '/production-orders', '/production-plans', '/stock-levels', '/organizations', '/bank-accounts', '/warehouses', '/cost-items', '/documents', '/order-calculations', '/stock', '/flows', '/flow-runs', '/work-orders', '/work-order-assignments', '/work-order-kinds', '/document-states', '/services', '/contracts', '/tariff-plans', '/billing', '/other-costs', '/material-allocations', '/investments', '/processing', '/processor-reports', '/supplier-orders', '/serials', '/repair-items', '/sales-plan', '/appointments', '/delivery-methods', '/deliveries', '/positions', '/product-kinds', '/leads', '/lead-statuses', '/lead-forms', '/lead-sources', '/ad-campaigns', '/ad-expenses', '/ad-report', '/secrets', '/payments', '/payment-calendar', '/payment-requests', '/opening-balances', '/bank-import', '/cash-registers', '/cash-flow-items', '/bank-connections', '/payment-links', '/payroll', '/pricing', '/doc-templates'];

function buildTenantApi() {
  const guarded = new Hono<AppEnv>();
  for (const p of TENANT_PATHS) {
    guarded.use(p, requireSession, tenant());
    guarded.use(`${p}/*`, requireSession, tenant());
  }
  return guarded
    .route('/projects', projectRoutes)
    .route('/statuses', statusRoutes)
    .route('/tasks', taskRoutes)
    .route('/comments', commentRoutes)
    .route('/time-logs', timeLogRoutes)
    .route('/notifications', notificationRoutes)
    .route('/members', memberRoutes)
    .route('/teams', teamRoutes)
    .route('/saved-views', savedViewRoutes)
    .route('/calendar-events', calendarEventRoutes)
    .route('/files', fileRoutes)
    .route('/activity', activityRoutes)
    .route('/events', eventRoutes)
    .route('/companies', companyRoutes)
    .route('/companies', companyBankRoutes)
    .route('/contacts', contactRoutes)
    .route('/deals', dealRoutes)
    .route('/crm-activities', crmActivityRoutes)
    .route('/leads', leadRoutes)
    .route('/lead-statuses', leadStatusRoutes)
    .route('/lead-sources', leadSourceRoutes)
    .route('/ad-campaigns', adCampaignRoutes)
    .route('/ad-expenses', adExpenseRoutes)
    .route('/ad-report', adReportRoutes)
    .route('/lead-forms', leadFormRoutes)
    .route('/entities', entityRoutes)
    .route('/data-search', dataSearchRoutes)
    .route('/data', recordsRoutes)
    .route('/units', unitRoutes)
    .route('/product-categories', categoryRoutes)
    .route('/attribute-defs', attributeRoutes)
    .route('/products', productRoutes)
    .route('/products', variantRoutes)
    .route('/work-centers', workCenterRoutes)
    .route('/manufactured-items', itemRoutes)
    .route('/bom-lines', bomLineRoutes)
    .route('/production', productionRoutes)
    .route('/production', productionWorkbenchRoutes)
    .route('/production', productionStageRoutes)
    .route('/production', productionReportRoutes)
    .route('/production', pieceworkRoutes)
    .route('/production', planningRoutes)
    .route('/production', productionClosingRoutes)
    .route('/order-calculations', calculationRoutes)
    .route('/production-orders', productionOrderRoutes)
    .route('/production-orders', operationAssignmentRoutes)
    .route('/production-plans', productionPlanRoutes)
    .route('/stock-levels', stockLevelRoutes)
    .route('/organizations', organizationRoutes)
    .route('/organizations', organizationBankRoutes)
    .route('/bank-accounts', bankAccountRoutes)
    .route('/warehouses', warehouseRoutes)
    .route('/cost-items', costItemRoutes)
    .route('/documents', documentRoutes)
    .route('/other-costs', otherCostsRoutes)
    .route('/material-allocations', materialAllocationRoutes)
    .route('/investments', investmentRoutes)
    .route('/payments', paymentRoutes)
    .route('/payment-calendar', paymentCalendarRoutes)
    .route('/payment-requests', paymentRequestRoutes)
    .route('/opening-balances', openingBalanceRoutes)
    .route('/payroll', payrollRoutes)
    .route('/pricing', pricingRoutes)
    .route('/doc-templates', docTemplateRoutes)
    .route('/bank-import', bankImportRoutes)
    .route('/cash-registers', cashRegisterRoutes)
    .route('/cash-flow-items', cashFlowItemRoutes)
    .route('/processing', tollingRoutes)
    .route('/supplier-orders', processorTransferRoutes)
    .route('/processor-reports', processorReportRoutes)
    .route('/production-orders', componentOwnerRoutes)
    .route('/work-orders', workOrderRoutes)
    .route('/serials', serialRoutes)
    .route('/delivery-methods', deliveryMethodRoutes)
    .route('/deliveries', deliveryRoutes)
    .route('/positions', positionRoutes)
    .route('/product-kinds', productKindRoutes)
    .route('/secrets', secretRoutes)
    .route('/bank-connections', bankConnectionRoutes)
    .route('/payment-links', paymentLinkRoutes)
    .route('/repair-items', repairItemRoutes)
    .route('/work-order-assignments', workOrderAssignmentRoutes)
    .route('/work-order-kinds', workOrderKindRoutes)
    .route('/document-states', documentStateRoutes)
    .route('/services', serviceRoutes)
    .route('/services', serviceReportRoutes)
    .route('/sales-plan', salesPlanRoutes)
    .route('/appointments', appointmentRoutes)
    .route('/contracts', contractRoutes)
    .route('/tariff-plans', tariffPlanRoutes)
    .route('/billing', billingRoutes)
    .route('/stock', stockRoutes)
    .route('/flows', flowRoutes)
    .route('/flow-runs', flowRunRoutes);
}

export function createApp(deps: AppDeps) {
  const config: AppConfig = { ...loadConfig(), ...deps.config };
  const hub = deps.hub ?? new Hub(databaseUrl());
  const tenantApi = buildTenantApi();

  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('sql', deps.sql);
      c.set('config', config);
      let ip = 'unknown';
      try {
        ip = (config.trustProxy ? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() : undefined) ?? getConnInfo(c).remote.address ?? 'unknown';
      } catch {
        /* вне Bun.serve (тесты через app.request) адреса нет */
      }
      c.set('ip', ip);
      await next();
    })
    .use('*', requestLogger)
    .use(
      '*',
      createMiddleware<AppEnv>(async (c, next) => {
        // публичные вебхуки сами отвечают CORS для любых сайтов (без cookie)
        if (!config.corsOrigins.length || c.req.path.startsWith('/hooks/')) return next();
        return cors({ origin: config.corsOrigins, credentials: true, allowHeaders: ['Content-Type', 'X-Workspace-Id', 'X-Request-Id'], exposeHeaders: ['X-Request-Id'] })(c, next);
      }),
    )
    .get('/health', async c => {
      // Пул без свободных соединений ставит запрос в очередь без таймаута — ограничиваем ожидание сами
      let timer: Timer | undefined;
      try {
        await Promise.race([c.get('sql')`select 1`, new Promise((_, reject) => (timer = setTimeout(() => reject(dbUnavailable()), HEALTH_TIMEOUT_MS)))]);
        return c.json({ status: 'ok' as const, db: 'up' as const, time: new Date().toISOString(), ws: hub.connections });
      } catch {
        return c.json({ status: 'degraded' as const, db: 'down' as const, time: new Date().toISOString(), ws: hub.connections }, 503);
      } finally {
        clearTimeout(timer);
      }
    })
    .route('/auth', authRoutes)
    .route('/workspaces', workspaceRoutes)
    .route('/invites', inviteRoutes)
    .route('/admin', adminRoutes)
    .route('/hooks', hookRoutes)
    // WebSocket: сессия (cookie) → членство → подписка на события воркспейса. Воркспейс — ?workspace=<uuid> (браузер не ставит заголовки)
    .get(
      '/ws',
      requireSession,
      createMiddleware<AppEnv>(async (c, next) => {
        const wsId = (c.req.query('workspace') ?? c.req.header('x-workspace-id') ?? '').toLowerCase();
        if (!isUuid(wsId)) throw new AppError(400, 'workspace_required', 'Query parameter "workspace" must be a workspace UUID');
        const origin = c.req.header('origin');
        if (origin && config.corsOrigins.length && !config.corsOrigins.includes(origin) && new URL(origin).host !== c.req.header('host')) throw forbidden('Origin is not allowed');
        const user = c.get('user');
        const ok = await withContext(c.get('sql'), { userId: user.id }, async (db, tx) => {
          const [ms] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.workspaceId, wsId), eq(memberships.userId, user.id))).limit(1);
          if (!ms) return false;
          await tx`select set_config('app.workspace_id', ${wsId}, true)`;
          const [me] = await db.select({ status: members.status }).from(members).where(and(eq(members.workspaceId, wsId), eq(members.userId, user.id))).limit(1);
          return !!me && me.status !== 'deactivated';
        });
        if (!ok) throw forbidden('You are not a member of this workspace');
        c.set('workspaceId', wsId);
        await next();
      }),
      upgradeWebSocket(c => {
        const wsId = c.get('workspaceId');
        const since = c.req.query('since');
        const userId = c.get('user').id;
        const sql = c.get('sql');
        return {
          onOpen: async (_evt, ws) => {
            hub.join(wsId, ws.raw as never);
            ws.send(JSON.stringify({ type: 'ready', workspaceId: wsId }));
            // Догоняем пропущенное: события после since (id — uuid v7). Клиент дедуплицирует по event.id
            if (since && isUuid(since)) {
              const missed = await withContext(sql, { userId, workspaceId: wsId }, db => db.select().from(events).where(gt(events.id, since)).orderBy(events.id).limit(500));
              for (const e of missed) ws.send(JSON.stringify({ type: 'event', event: { id: e.id, workspaceId: e.workspaceId, type: e.type, entity: e.entity, recordId: e.recordId, actorId: e.actorId, createdAt: e.createdAt.toISOString() }, replay: true }));
            }
          },
          onMessage: (evt, ws) => {
            if (String(evt.data) === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
          },
          onClose: (_evt, ws) => hub.leave(wsId, ws.raw as never),
        };
      }),
    )
    .route('/', tenantApi)
    .onError(onError)
    .notFound(onNotFound);

  return { app, hub };
}

/** Тип для типизированного клиента: `hc<AppType>(baseUrl)` из hono/client */
export type AppType = ReturnType<typeof createApp>['app'];
