/* Настройки — порт pageSettings и settingsBody из pages/settings.js.
   Раздел — часть адреса (/settings/:section), поэтому переключается ссылками и работает с кнопкой «назад». */
import * as React from 'react';
import { NavLink, Navigate, useParams } from 'react-router';
import { SECTIONS } from '../routes';
import { DEFAULT_SECTION, SET_NAV } from '../settings/nav';
import { AppearanceSection, DateTimeSection, LanguageSection, MembersSection, PermissionsSection, ProjectsSection, TeamsSection, WorkspaceSection } from '../settings/general';
import { DataModelSection } from '../settings/data-model';
import { ProductionSection } from '../settings/production';
import { CostItemsSection, OrganizationsSection, WarehousesSection } from '../settings/documents';
import { WorkOrderKindsSection } from '../settings/work-orders';
import { DeliveryMethodsSection } from '../settings/delivery';
import { PositionsSection, ProductKindsSection } from '../settings/positions';
import { LeadFormsSection, LeadStatusesSection } from '../settings/leads';
import { DealPipelinesSection, LostReasonsSection } from '../settings/deal-pipelines';
import { LeadSourcesSection } from '../settings/lead-sources';
import { IntegrationsSection } from '../settings/integrations';
import { TenantsSection } from '../settings/tenants';
import { PlansSection } from '../settings/plans';
import { RequestsSection } from '../settings/requests';
import { useLicense } from '../licensing/data';
import { MODULE_OF_SETTING } from '@gr8r/shared';
import { useSession } from '../data/session';
import { NotificationsSection, PreferencesSection, ProfileSection, ShortcutsSection } from '../settings/personal';
import { InvoicesSection, PasswordSection, PaymentSection, PlanSection, SessionsSection, TwoFactorSection } from '../settings/account';
import { NotFoundPage } from './PlaceholderPage';
import { useT, type TKey } from '@/i18n';

function Body({ sec, title }: { sec: string; title: string }) {
  switch (sec) {
    case 'workspace':
      return <WorkspaceSection title={title} />;
    case 'appearance':
      return <AppearanceSection title={title} />;
    case 'language':
      return <LanguageSection title={title} />;
    case 'datetime':
      return <DateTimeSection title={title} />;
    case 'members':
      return <MembersSection title={title} />;
    case 'teams':
      return <TeamsSection title={title} />;
    case 'projects':
      return <ProjectsSection title={title} />;
    case 'permissions':
      return <PermissionsSection title={title} />;
    case 'data-model':
      return <DataModelSection title={title} />;
    case 'production':
      return <ProductionSection title={title} />;
    case 'organizations':
      return <OrganizationsSection title={title} />;
    case 'warehouses':
      return <WarehousesSection title={title} />;
    case 'cost-items':
      return <CostItemsSection title={title} />;
    case 'work-orders':
      return <WorkOrderKindsSection title={title} />;
    case 'delivery-methods':
      return <DeliveryMethodsSection title={title} />;
    case 'positions':
      return <PositionsSection title={title} />;
    case 'deal-pipelines':
      return <DealPipelinesSection title={title} />;
    case 'lost-reasons':
      return <LostReasonsSection title={title} />;
    case 'lead-statuses':
      return <LeadStatusesSection title={title} />;
    case 'lead-forms':
      return <LeadFormsSection title={title} />;
    case 'lead-sources':
      return <LeadSourcesSection title={title} />;
    case 'integrations':
      return <IntegrationsSection title={title} />;
    case 'plans':
      return <PlansSection title={title} />;
    case 'requests':
      return <RequestsSection title={title} />;
    case 'tenants':
      return <TenantsSection title={title} />;
    case 'product-kinds':
      return <ProductKindsSection title={title} />;
    case 'notif-email':
    case 'notif-push':
    case 'notif-mentions':
    case 'notif-assign':
      return <NotificationsSection id={sec} title={title} />;
    case 'profile':
      return <ProfileSection title={title} />;
    case 'preferences':
      return <PreferencesSection title={title} />;
    case 'shortcuts':
      return <ShortcutsSection title={title} />;
    case 'password':
      return <PasswordSection title={title} />;
    case 'sessions':
      return <SessionsSection title={title} />;
    case '2fa':
      return <TwoFactorSection title={title} />;
    case 'plan':
      return <PlanSection title={title} />;
    case 'payment':
      return <PaymentSection title={title} />;
    default:
      return <InvoicesSection title={title} />;
  }
}

export function SettingsPage() {
  const t = useT();
  const { section } = useParams();
  const { user } = useSession();
  const modules = useLicense().data?.modules;
  // пункты выключенных модулей (docs/architecture/licensing.md) скрыты, пока набор не загружен — видны все
  const moduleOn = (k: string) => {
    const m = MODULE_OF_SETTING.get(k);
    return !m || !modules || (modules as string[]).includes(m);
  };
  const nav = (user?.isOperator ? SET_NAV : SET_NAV.filter(([g]) => g !== 'operator')).map(([g, items]) => [g, items.filter(([k]) => moduleOn(k))] as (typeof SET_NAV)[number]);
  if (!section) return <Navigate to={`${SECTIONS.settings.path}/${DEFAULT_SECTION}`} replace />;
  const cur = nav.flatMap(g => g[1]).find(x => x[0] === section);
  if (!cur) return <NotFoundPage />;
  return (
    <div className="set">
      <nav className="set-nav" aria-label={t('pages.settings.navLabel')}>
        {nav.map(([g, items]) => (
          <React.Fragment key={g}>
            <div className="gh">{t(`settings.nav.groups.${g}` as TKey)}</div>
            {items.map(([k, nKey, Icon]) => (
              <NavLink key={k} to={`${SECTIONS.settings.path}/${k}`} className={({ isActive }) => `sitem ${isActive ? 'on' : ''}`}>
                <Icon size={15} />
                <span>{t(`settings.nav.items.${nKey}` as TKey)}</span>
              </NavLink>
            ))}
          </React.Fragment>
        ))}
      </nav>
      <div className="set-body">
        <div className="set-in">
          <Body sec={section} title={t(`settings.nav.items.${cur[1]}` as TKey)} />
        </div>
      </div>
    </div>
  );
}
