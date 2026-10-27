/* Страница компании — шапка как у страницы проекта и вкладки Overview / Deals / Contacts / Activity */
import * as React from 'react';
import { Link, useParams } from 'react-router';
import { Activity, Briefcase, FileSignature, FileText, Files, CircleDollarSign, ExternalLink, Globe, LayoutDashboard, MapPin, Plus, Ruler, User, UserPlus, Users, Clock, type LucideIcon } from 'lucide-react';
import { Badge, Button, EmptyState, Tooltip } from '@/components/ui';
import { DataTable, useDataTable } from '@/components/gr8r/data-table';
import { Panel, Stat } from '@/components/gr8r/panel';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { dayBucket } from '../data/selectors';
import { ago, fmtDate } from '../lib/dates';
import { NotFoundPage } from '../pages/PlaceholderPage';
import { ActivityComposer, ActivityRow, CloseDate, CompanyLogo, OwnerField, PersonCell, StageIcon, useOwnerName } from './components';
import { contactColumnsInCompany, dealColumnsInCompany } from './columns';
import { money } from './format';
import { activitiesOfCompany, companyStats, contactRows, dealRows, dealsOfCompany, company as findCompany, openDeals } from './selectors';
import { useCrm } from './store';
import { useCrmUi } from './ui-context';
import { useCustomRows } from '../meta/custom-fields';
import { CompanyRequisitesTab } from '../docs/CompanyRequisites';
import { CompanyContractsTab } from '../docs/CompanyContracts';
import { CompanyDocumentsTab } from '../docs/CompanyDocuments';
import { industryName, sizeName, stageName } from './labels';
import type { Company } from './types';

const TABS: [string, LucideIcon][] = [
  ['overview', LayoutDashboard],
  ['deals', CircleDollarSign],
  ['contacts', Users],
  ['activity', Activity],
  ['requisites', FileText],
  ['contracts', FileSignature],
  ['documents', Files],
];

export function CompanyPage() {
  const { id, tab } = useParams();
  const { data } = useCrm();
  const co = findCompany(data, id);
  if (!co) return <NotFoundPage />;
  return <CompanyView key={co.id} company={co} tab={tab || 'overview'} />;
}

function CompanyView({ company: co, tab }: { company: Company; tab: string }) {
  const { data, dispatch } = useCrm();
  const ui = useCrmUi();
  const ownerName = useOwnerName();
  const t = useT();
  const dealCols = React.useMemo(() => dealColumnsInCompany(t), [t]);
  const contactCols = React.useMemo(() => contactColumnsInCompany(t), [t]);
  const dealTable = useDataTable(dealCols);
  const contactTable = useDataTable(contactCols);
  const stats = companyStats(data, co.id);
  const deals = dealsOfCompany(data, co.id);
  const acts = activitiesOfCompany(data, co.id);
  const counts: Record<string, number | undefined> = { deals: deals.length, contacts: stats.contacts, activity: acts.length };

  let body: React.ReactNode;
  if (tab === 'deals')
    body = (
      <>
        <div className="toolbar">
          <span className="muted" style={{ fontSize: 12.5 }}>
            {t('crm.companies.page.dealsCount', { count: deals.length, pipeline: money(stats.pipeline), won: money(stats.won) })}
          </span>
          <span className="sp" />
          <Button size="sm" variant="primary" onClick={() => ui.newDeal({ company: co.id, owner: co.owner })}>
            <Plus size={13} />
            {t('crm.deals.newDeal')}
          </Button>
        </div>
        <DataTable
          aria-label={`${co.name} deals`}
          columns={dealCols}
          rows={dealRows(data, ownerName, deals)}
          table={dealTable}
          getId={r => r.id}
          onRowClick={r => ui.openDeal(r.id)}
          empty={
            <EmptyState icon={<CircleDollarSign size={20} />} title={t('crm.companies.page.noDeals')} action={<Button size="sm" variant="primary" onClick={() => ui.newDeal({ company: co.id, owner: co.owner })}><Plus size={14} />{t('crm.deals.newDeal')}</Button>}>
              {t('crm.companies.page.noDealsHint', { name: co.name })}
            </EmptyState>
          }
        />
      </>
    );
  else if (tab === 'contacts')
    body = (
      <>
        <div className="toolbar">
          <span className="muted" style={{ fontSize: 12.5 }}>{t('crm.companies.page.people', { count: stats.contacts, name: co.name })}</span>
          <span className="sp" />
          <Button size="sm" variant="primary" onClick={() => ui.newContact({ company: co.id })}>
            <UserPlus size={13} />
            {t('crm.contacts.newContact')}
          </Button>
        </div>
        <DataTable
          aria-label={`${co.name} contacts`}
          columns={contactCols}
          rows={contactRows(data, ownerName).filter(r => r.company === co.id)}
          table={contactTable}
          getId={r => r.id}
          onRowClick={r => ui.openContact(r.id)}
          empty={
            <EmptyState icon={<Users size={20} />} title={t('crm.companies.page.noContacts')} action={<Button size="sm" variant="primary" onClick={() => ui.newContact({ company: co.id })}><UserPlus size={14} />{t('crm.contacts.newContact')}</Button>}>
              {t('crm.companies.page.noContactsHint', { name: co.name })}
            </EmptyState>
          }
        />
      </>
    );
  else if (tab === 'activity') {
    const buckets = new Map<string, typeof acts>();
    for (const a of acts) buckets.set(dayBucket(a.at), [...(buckets.get(dayBucket(a.at)) ?? []), a]);
    body = (
      <div className="page" style={{ maxWidth: 820, paddingTop: 12 }}>
        <ActivityComposer company={co.id} />
        {[...buckets].map(([k, items]) => (
          <React.Fragment key={k}>
            <div className="day-h">{k}</div>
            <div className="feed lined">
              {items.map(a => (
                <ActivityRow key={a.id} a={a} showDeal />
              ))}
            </div>
          </React.Fragment>
        ))}
        {!acts.length && <p className="faint" style={{ marginTop: 14 }}>{t('crm.companies.page.noActivity')}</p>}
      </div>
    );
  } else if (tab === 'requisites') body = <CompanyRequisitesTab companyId={co.id} />;
  else if (tab === 'contracts') body = <CompanyContractsTab companyId={co.id} />;
  else if (tab === 'documents') body = <CompanyDocumentsTab companyId={co.id} />;
  else body = <Overview company={co} />;

  return (
    <div className="page flush">
      <div className="proj-h">
        <div className="t">
          <CompanyLogo name={co.name} size={36} className="lg" />
          <h1>{co.name}</h1>
          <Badge>{industryName(co.industry, co.industry)}</Badge>
          <Badge tone="gray">{sizeName(co.size, co.size)} {t('crm.companies.overview.sizeUnit')}</Badge>
          <span className="sp" />
          <div className="row" style={{ gap: 4 }}>
            <span className="muted hide-m" style={{ fontSize: 12.5 }}>{t('crm.companies.header.ownerLabel')}</span>
            <OwnerField value={co.owner} onChange={owner => dispatch({ type: 'company/update', id: co.id, patch: { owner } })} />
            <Tooltip content={co.website}>
              <a className="ibtn ibtn-sm" href={`https://${co.website}`} target="_blank" rel="noreferrer" aria-label={t('crm.companies.openWebsite', { website: co.website })}>
                <ExternalLink size={15} />
              </a>
            </Tooltip>
            <Button size="sm" className="hide-m" onClick={() => ui.newContact({ company: co.id })}>
              <UserPlus size={13} />
              {t('crm.companies.header.newContact')}
            </Button>
            <Button size="sm" variant="primary" onClick={() => ui.newDeal({ company: co.id, owner: co.owner })}>
              <Plus size={13} />
              <span className="hide-m">{t('crm.companies.header.newDeal')}</span>
            </Button>
          </div>
        </div>
        <nav className="tabs" aria-label={t('crm.companies.title')}>
          {TABS.map(([k, Icon]) => (
            <Link key={k} to={`/crm/companies/${co.id}/${k}`} className={cn('tab', tab === k && 'on')} aria-current={tab === k ? 'page' : undefined}>
              <Icon size={14} />
              {t(`crm.companies.tabs.${k}` as any)}
              {counts[k] != null && <span className="cnt">{counts[k]}</span>}
            </Link>
          ))}
        </nav>
      </div>
      <div className="pbody">{body}</div>
    </div>
  );
}

function Overview({ company: co }: { company: Company }) {
  const { data, dispatch } = useCrm();
  const ui = useCrmUi();
  const t = useT();
  const customRows = useCustomRows('company', co.custom, patch => dispatch({ type: 'company/update', id: co.id, patch: { custom: { ...co.custom, ...patch } } }));
  const stats = companyStats(data, co.id);
  const open = openDeals(dealsOfCompany(data, co.id)).sort((a, b) => (a.closeDate > b.closeDate ? 1 : -1));
  const people = data.contacts.filter(c => c.company === co.id);
  const acts = activitiesOfCompany(data, co.id).slice(0, 5);
  const wonCount = dealsOfCompany(data, co.id).filter(d => d.stage === 'won').length;
  return (
    <div className="page" style={{ maxWidth: 1160, paddingTop: 22 }}>
      <div className="stats" style={{ marginBottom: 16 }}>
        <Stat label={t('crm.companies.overview.statOpenDeals')} value={stats.open} note={t('crm.companies.overview.statOpenDealsNote', { total: dealsOfCompany(data, co.id).length })} />
        <Stat label={t('crm.companies.overview.statPipeline')} value={money(stats.pipeline)} note={t('crm.companies.overview.statPipelineNote')} />
        <Stat label={t('crm.companies.overview.statWon')} value={money(stats.won)} note={t('crm.companies.overview.statWonNote', { count: wonCount })} tone={stats.won ? 'up' : undefined} />
        <Stat label={t('crm.companies.overview.statLastActivity')} value={stats.lastActivity ? ago(stats.lastActivity) : '—'} note={t('crm.companies.overview.statLastActivityNote', { count: stats.contacts })} />
      </div>
      <div className="grid2">
        <div className="stack">
          <Panel title={t('crm.companies.overview.openDeals')} actions={<Button size="sm" variant="ghost" onClick={() => ui.newDeal({ company: co.id, owner: co.owner })}><Plus size={13} />{t('crm.companies.overview.newDeal')}</Button>}>
            <div className="panel-b">
              {open.length ? (
                open.map(d => (
                  <div key={d.id} className="row crm-row" role="button" tabIndex={0} onClick={() => ui.openDeal(d.id)} onKeyDown={e => e.key === 'Enter' && ui.openDeal(d.id)}>
                    <StageIcon stage={d.stage} />
                    <span className="grow trunc">{d.name}</span>
                    <span className="faint hide-m" style={{ width: 84 }}>{stageName(d.stage, d.stage)}</span>
                    <span className="hide-m" style={{ width: 90 }}><CloseDate deal={d} /></span>
                    <span className="num" style={{ width: 84, textAlign: 'right' }}>{money(d.amount)}</span>
                  </div>
                ))
              ) : (
                <div className="faint">{t('crm.companies.overview.noOpenDeals')}</div>
              )}
            </div>
          </Panel>
          <Panel title={t('crm.companies.overview.recentActivity')}>
            <div className="panel-b">
              {acts.length ? (
                <div className="feed lined">
                  {acts.map(a => (
                    <ActivityRow key={a.id} a={a} showDeal />
                  ))}
                </div>
              ) : (
                <div className="faint">{t('crm.companies.overview.nothingLogged')}</div>
              )}
            </div>
          </Panel>
        </div>
        <div className="stack">
          <Panel title={t('crm.companies.overview.about')}>
            <div className="panel-b">
              <dl className="kv" style={{ margin: 0 }}>
                <dt>
                  <Briefcase size={14} />
                  {t('crm.companies.overview.industry')}
                </dt>
                <dd>{industryName(co.industry, co.industry)}</dd>
                <dt>
                  <Ruler size={14} />
                  {t('crm.companies.overview.size')}
                </dt>
                <dd>{sizeName(co.size, co.size)} {t('crm.companies.overview.sizeUnit')}</dd>
                <dt>
                  <Globe size={14} />
                  {t('crm.companies.overview.website')}
                </dt>
                <dd>
                  <a className="crm-link" href={`https://${co.website}`} target="_blank" rel="noreferrer">
                    {co.website}
                  </a>
                </dd>
                <dt>
                  <MapPin size={14} />
                  {t('crm.companies.overview.city')}
                </dt>
                <dd>{co.city || <span className="faint">—</span>}</dd>
                <dt>
                  <User size={14} />
                  {t('crm.companies.overview.owner')}
                </dt>
                <dd>
                  <OwnerField value={co.owner} onChange={owner => dispatch({ type: 'company/update', id: co.id, patch: { owner } })} />
                </dd>
                <dt>
                  <Clock size={14} />
                  {t('crm.companies.overview.added')}
                </dt>
                <dd className="muted num">{fmtDate(new Date(co.created))}</dd>
                {customRows.map(r => (
                  <React.Fragment key={r.field.key}>
                    <dt>
                      <r.icon size={14} />
                      {r.label}
                    </dt>
                    <dd>{r.node}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </div>
          </Panel>
          <Panel title={t('crm.companies.overview.contacts')} actions={<Button size="sm" variant="ghost" onClick={() => ui.newContact({ company: co.id })}><UserPlus size={13} />{t('crm.companies.header.add')}</Button>}>
            <div className="panel-b">
              {people.length ? (
                people.map(p => (
                  <div key={p.id} className="row crm-row" role="button" tabIndex={0} onClick={() => ui.openContact(p.id)} onKeyDown={e => e.key === 'Enter' && ui.openContact(p.id)}>
                    <PersonCell name={p.name} />
                    <span className="grow" />
                    <span className="faint trunc" style={{ fontSize: 12 }}>{p.title}</span>
                  </div>
                ))
              ) : (
                <div className="faint">{t('crm.companies.overview.noContacts')}</div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
