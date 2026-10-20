/* Страница компании — шапка как у страницы проекта и вкладки Overview / Deals / Contacts / Activity */
import * as React from 'react';
import { Link, useParams } from 'react-router';
import { Activity, Briefcase, CircleDollarSign, ExternalLink, Globe, LayoutDashboard, MapPin, Plus, Ruler, User, UserPlus, Users, Clock, type LucideIcon } from 'lucide-react';
import { Badge, Button, EmptyState, Tooltip } from '@/components/ui';
import { DataTable, useDataTable } from '@/components/gr8r/data-table';
import { Panel, Stat } from '@/components/gr8r/panel';
import { cn } from '@/lib/utils';
import { dayBucket } from '../data/selectors';
import { ago, fmtDate } from '../lib/dates';
import { NotFoundPage } from '../pages/PlaceholderPage';
import { ActivityComposer, ActivityRow, CloseDate, CompanyLogo, OwnerField, PersonCell, StageIcon, useOwnerName } from './components';
import { CONTACT_COLUMNS_IN_COMPANY, DEAL_COLUMNS_IN_COMPANY } from './columns';
import { money } from './format';
import { activitiesOfCompany, companyStats, contactRows, dealRows, dealsOfCompany, company as findCompany, openDeals } from './selectors';
import { stage } from './stages';
import { useCrm } from './store';
import { useCrmUi } from './ui-context';
import { useCustomRows } from '../meta/custom-fields';
import type { Company } from './types';

const TABS: [string, string, LucideIcon][] = [
  ['overview', 'Overview', LayoutDashboard],
  ['deals', 'Deals', CircleDollarSign],
  ['contacts', 'Contacts', Users],
  ['activity', 'Activity', Activity],
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
  const dealTable = useDataTable(DEAL_COLUMNS_IN_COMPANY);
  const contactTable = useDataTable(CONTACT_COLUMNS_IN_COMPANY);
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
            {deals.length} deals · {money(stats.pipeline)} open · {money(stats.won)} won
          </span>
          <span className="sp" />
          <Button size="sm" variant="primary" onClick={() => ui.newDeal({ company: co.id, owner: co.owner })}>
            <Plus size={13} />
            New deal
          </Button>
        </div>
        <DataTable
          aria-label={`${co.name} deals`}
          columns={DEAL_COLUMNS_IN_COMPANY}
          rows={dealRows(data, ownerName, deals)}
          table={dealTable}
          getId={r => r.id}
          onRowClick={r => ui.openDeal(r.id)}
          empty={
            <EmptyState icon={<CircleDollarSign size={20} />} title="No deals yet" action={<Button size="sm" variant="primary" onClick={() => ui.newDeal({ company: co.id, owner: co.owner })}><Plus size={14} />New deal</Button>}>
              Create a deal to start tracking revenue from {co.name}.
            </EmptyState>
          }
        />
      </>
    );
  else if (tab === 'contacts')
    body = (
      <>
        <div className="toolbar">
          <span className="muted" style={{ fontSize: 12.5 }}>{stats.contacts} people at {co.name}</span>
          <span className="sp" />
          <Button size="sm" variant="primary" onClick={() => ui.newContact({ company: co.id })}>
            <UserPlus size={13} />
            New contact
          </Button>
        </div>
        <DataTable
          aria-label={`${co.name} contacts`}
          columns={CONTACT_COLUMNS_IN_COMPANY}
          rows={contactRows(data, ownerName).filter(r => r.company === co.id)}
          table={contactTable}
          getId={r => r.id}
          onRowClick={r => ui.openContact(r.id)}
          empty={
            <EmptyState icon={<Users size={20} />} title="No contacts yet" action={<Button size="sm" variant="primary" onClick={() => ui.newContact({ company: co.id })}><UserPlus size={14} />New contact</Button>}>
              Add the people you talk to at {co.name}.
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
        {!acts.length && <p className="faint" style={{ marginTop: 14 }}>No activity yet. Log the first call or note above.</p>}
      </div>
    );
  } else body = <Overview company={co} />;

  return (
    <div className="page flush">
      <div className="proj-h">
        <div className="t">
          <CompanyLogo name={co.name} size={36} className="lg" />
          <h1>{co.name}</h1>
          <Badge>{co.industry}</Badge>
          <Badge tone="gray">{co.size} people</Badge>
          <span className="sp" />
          <div className="row" style={{ gap: 4 }}>
            <span className="muted hide-m" style={{ fontSize: 12.5 }}>Owner</span>
            <OwnerField value={co.owner} onChange={owner => dispatch({ type: 'company/update', id: co.id, patch: { owner } })} />
            <Tooltip content={co.website}>
              <a className="ibtn ibtn-sm" href={`https://${co.website}`} target="_blank" rel="noreferrer" aria-label={`Open ${co.website}`}>
                <ExternalLink size={15} />
              </a>
            </Tooltip>
            <Button size="sm" className="hide-m" onClick={() => ui.newContact({ company: co.id })}>
              <UserPlus size={13} />
              New contact
            </Button>
            <Button size="sm" variant="primary" onClick={() => ui.newDeal({ company: co.id, owner: co.owner })}>
              <Plus size={13} />
              <span className="hide-m">New deal</span>
            </Button>
          </div>
        </div>
        <nav className="tabs" aria-label="Company views">
          {TABS.map(([k, name, Icon]) => (
            <Link key={k} to={`/crm/companies/${co.id}/${k}`} className={cn('tab', tab === k && 'on')} aria-current={tab === k ? 'page' : undefined}>
              <Icon size={14} />
              {name}
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
  const customRows = useCustomRows('company', co.custom, patch => dispatch({ type: 'company/update', id: co.id, patch: { custom: { ...co.custom, ...patch } } }));
  const stats = companyStats(data, co.id);
  const open = openDeals(dealsOfCompany(data, co.id)).sort((a, b) => (a.closeDate > b.closeDate ? 1 : -1));
  const people = data.contacts.filter(c => c.company === co.id);
  const acts = activitiesOfCompany(data, co.id).slice(0, 5);
  const wonCount = dealsOfCompany(data, co.id).filter(d => d.stage === 'won').length;
  return (
    <div className="page" style={{ maxWidth: 1160, paddingTop: 22 }}>
      <div className="stats" style={{ marginBottom: 16 }}>
        <Stat label="Open deals" value={stats.open} note={`${dealsOfCompany(data, co.id).length} deals in total`} />
        <Stat label="In pipeline" value={money(stats.pipeline)} note="open deal value" />
        <Stat label="Won revenue" value={money(stats.won)} note={`${wonCount} closed won`} tone={stats.won ? 'up' : undefined} />
        <Stat label="Last activity" value={stats.lastActivity ? ago(stats.lastActivity) : '—'} note={`${stats.contacts} contacts`} />
      </div>
      <div className="grid2">
        <div className="stack">
          <Panel title="Open deals" actions={<Button size="sm" variant="ghost" onClick={() => ui.newDeal({ company: co.id, owner: co.owner })}><Plus size={13} />New deal</Button>}>
            <div className="panel-b">
              {open.length ? (
                open.map(d => (
                  <div key={d.id} className="row crm-row" role="button" tabIndex={0} onClick={() => ui.openDeal(d.id)} onKeyDown={e => e.key === 'Enter' && ui.openDeal(d.id)}>
                    <StageIcon stage={d.stage} />
                    <span className="grow trunc">{d.name}</span>
                    <span className="faint hide-m" style={{ width: 84 }}>{stage(d.stage).name}</span>
                    <span className="hide-m" style={{ width: 90 }}><CloseDate deal={d} /></span>
                    <span className="num" style={{ width: 84, textAlign: 'right' }}>{money(d.amount)}</span>
                  </div>
                ))
              ) : (
                <div className="faint">No open deals</div>
              )}
            </div>
          </Panel>
          <Panel title="Recent activity">
            <div className="panel-b">
              {acts.length ? (
                <div className="feed lined">
                  {acts.map(a => (
                    <ActivityRow key={a.id} a={a} showDeal />
                  ))}
                </div>
              ) : (
                <div className="faint">Nothing logged yet</div>
              )}
            </div>
          </Panel>
        </div>
        <div className="stack">
          <Panel title="About">
            <div className="panel-b">
              <dl className="kv" style={{ margin: 0 }}>
                <dt>
                  <Briefcase size={14} />
                  Industry
                </dt>
                <dd>{co.industry}</dd>
                <dt>
                  <Ruler size={14} />
                  Size
                </dt>
                <dd>{co.size} people</dd>
                <dt>
                  <Globe size={14} />
                  Website
                </dt>
                <dd>
                  <a className="crm-link" href={`https://${co.website}`} target="_blank" rel="noreferrer">
                    {co.website}
                  </a>
                </dd>
                <dt>
                  <MapPin size={14} />
                  City
                </dt>
                <dd>{co.city || <span className="faint">—</span>}</dd>
                <dt>
                  <User size={14} />
                  Owner
                </dt>
                <dd>
                  <OwnerField value={co.owner} onChange={owner => dispatch({ type: 'company/update', id: co.id, patch: { owner } })} />
                </dd>
                <dt>
                  <Clock size={14} />
                  Added
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
          <Panel title="Contacts" actions={<Button size="sm" variant="ghost" onClick={() => ui.newContact({ company: co.id })}><UserPlus size={13} />Add</Button>}>
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
                <div className="faint">No contacts yet</div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
