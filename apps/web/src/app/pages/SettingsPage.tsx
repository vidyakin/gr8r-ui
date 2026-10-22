/* Настройки — порт pageSettings и settingsBody из pages/settings.js.
   Раздел — часть адреса (/settings/:section), поэтому переключается ссылками и работает с кнопкой «назад». */
import * as React from 'react';
import { NavLink, Navigate, useParams } from 'react-router';
import { SECTIONS } from '../routes';
import { DEFAULT_SECTION, SET_NAV, SET_SECTIONS } from '../settings/nav';
import { AppearanceSection, DateTimeSection, LanguageSection, MembersSection, PermissionsSection, ProjectsSection, TeamsSection, WorkspaceSection } from '../settings/general';
import { DataModelSection } from '../settings/data-model';
import { ProductionSection } from '../settings/production';
import { CostItemsSection, OrganizationsSection, WarehousesSection } from '../settings/documents';
import { WorkOrderKindsSection } from '../settings/work-orders';
import { NotificationsSection, PreferencesSection, ProfileSection, ShortcutsSection } from '../settings/personal';
import { InvoicesSection, PasswordSection, PaymentSection, PlanSection, SessionsSection, TwoFactorSection } from '../settings/account';
import { NotFoundPage } from './PlaceholderPage';

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
  const { section } = useParams();
  if (!section) return <Navigate to={`${SECTIONS.settings.path}/${DEFAULT_SECTION}`} replace />;
  const cur = SET_SECTIONS.find(x => x[0] === section);
  if (!cur) return <NotFoundPage />;
  return (
    <div className="set">
      <nav className="set-nav" aria-label="Settings">
        {SET_NAV.map(([g, items]) => (
          <React.Fragment key={g}>
            <div className="gh">{g}</div>
            {items.map(([k, n, Icon]) => (
              <NavLink key={k} to={`${SECTIONS.settings.path}/${k}`} className={({ isActive }) => `sitem ${isActive ? 'on' : ''}`}>
                <Icon size={15} />
                <span>{n}</span>
              </NavLink>
            ))}
          </React.Fragment>
        ))}
      </nav>
      <div className="set-body">
        <div className="set-in">
          <Body sec={section} title={cur[1]} />
        </div>
      </div>
    </div>
  );
}
