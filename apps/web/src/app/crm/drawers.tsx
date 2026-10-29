/* Карточки сделки и контакта — EntityDrawer с полями CRM */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { Building2, Calendar as CalendarIcon, CircleCheck, CircleDollarSign, Clock, ClockAlert, Mail, Percent, Phone, RotateCcw, Trash2, User, UserPlus, Users, Briefcase, Layers, Megaphone, X, GitBranch } from 'lucide-react';
import { Button, ConfirmDialog, Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Progress, toast } from '@/components/ui';
import { EntityDrawer } from '@/components/gr8r/entity-drawer';
import { diffDays, fmtDate, parse, today } from '../lib/dates';
import { ActivityComposer, ActivityFeed, ActivityRow, CompanyLink, CompanyLogo, ContactLink, DateField, DealLink, OwnerField, PipelineField, StageField, StageHistory, StageIcon } from './components';
import { money, pct } from './format';
import { activitiesOfContact, activitiesOfDeal, company as findCompany, contact as findContact, contactsOfCompany, dealsOfContact, deal as findDeal, isOverdueDeal, probability, weighted } from './selectors';
import { isOpen, stage } from './stages';
import { stageName } from './labels';
import { useCrm, type DealPatch } from './store';
import { useCrmUi } from './ui-context';
import { ClientAppointments } from './ClientAppointments';
import { useCustomRows } from '../meta/custom-fields';
import { parseNumber, useT } from '@/i18n';
import { RecordAttribution } from './AttributionFields';

/** Сумма сделки: поле ввода без рамки, сохраняется по Enter или потере фокуса */
function AmountInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const t = useT();
  return (
    <input
      key={value}
      className="crm-inline"
      inputMode="decimal"
      defaultValue={money(value)}
      aria-label={t('crm.deals.drawer.amountAria')}
      onFocus={e => {
        e.currentTarget.value = String(value);
        e.currentTarget.select();
      }}
      onBlur={e => {
        const v = parseNumber(e.currentTarget.value);
        if (v > 0 && v !== value) onCommit(v);
        else e.currentTarget.value = money(value);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.currentTarget.value = String(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function DealDrawer({ id }: { id: string }) {
  const { data, dispatch, pipes } = useCrm();
  const ui = useCrmUi();
  const navigate = useNavigate();
  const t = useT();
  const d = findDeal(data, id);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  if (!d) return null;
  const co = findCompany(data, d.company);
  const open = isOpen(d.stage);
  const st = stage(d.stage);
  const reasonName = pipes.reasons.find(r => r.id === d.lostReasonId)?.name;
  const acts = activitiesOfDeal(data, d.id);
  const follow = acts.filter(a => a.type === 'task');
  const overdueDays = isOverdueDeal(d) ? -diffDays(parse(d.closeDate), today()) : 0;
  const people = d.contacts.filter(c => findContact(data, c));
  const companyPeople = contactsOfCompany(data, d.company);
  const update = (patch: DealPatch) => dispatch({ type: 'deal/update', id: d.id, patch });
  const customRows = useCustomRows('deal', d.custom, patch => update({ custom: { ...d.custom, ...patch } }));

  const banner =
    st.category === 'won' ? (
      <div className="alert ok">
        <CircleCheck size={15} />
        <span>
          {d.closedAt ? t('crm.deals.drawer.wonBannerDate', { date: fmtDate(d.closedAt), amount: money(d.amount) }) : t('crm.deals.drawer.wonBanner', { amount: money(d.amount) })}{' '}
          <button className="link" onClick={() => ui.moveDealTo(d.id, 'reopen')}>
            {t('crm.deals.drawer.reopen')}
          </button>
        </span>
      </div>
    ) : st.category === 'lost' ? (
      <div className="alert danger">
        <X size={15} />
        <span>
          {d.closedAt ? t('crm.deals.drawer.lostBannerDate', { date: fmtDate(d.closedAt) }) : t('crm.deals.drawer.lostBanner')}
          {reasonName ? `: ${reasonName}` : ''}{d.lostReason ? ` (${d.lostReason})` : ''}.{' '}
          <button className="link" onClick={() => ui.moveDealTo(d.id, 'reopen')}>
            {t('crm.deals.drawer.reopen')}
          </button>
        </span>
      </div>
    ) : overdueDays > 0 ? (
      <div className="alert danger">
        <ClockAlert size={15} />
        <span>
          {t('crm.deals.drawer.overdueBanner', { count: overdueDays })}
        </span>
      </div>
    ) : null;

  return (
    <>
      <EntityDrawer
        label={t('crm.deals.drawer.dealLabel', { name: d.name })}
        onClose={ui.closeDrawer}
        crumb={
          <>
            {co && (
              <button className="pillbtn" style={{ fontSize: 12.5 }} onClick={() => navigate(`/crm/companies/${co.id}`)}>
                <CompanyLogo name={co.name} size={16} />
                {co.name}
              </button>
            )}
            <span className="faint">/</span>
            <span className="faint" style={{ fontSize: 12, padding: '0 6px' }}>
              {t('crm.deals.drawer.crumbDeal')}
            </span>
          </>
        }
        actions={
          open ? (
            <Button size="sm" variant="ghost" onClick={() => ui.moveDealTo(d.id, 'won')}>
              <CircleCheck size={14} />
              <span className="hide-m">{t('crm.deals.markWonBtn')}</span>
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => ui.moveDealTo(d.id, 'reopen')}>
              <RotateCcw size={14} />
              <span className="hide-m">{t('crm.deals.drawer.reopenBtn')}</span>
            </Button>
          )
        }
        menu={
          <>
            {open && (
              <MenuItem icon={<X size={15} />} onSelect={() => ui.moveDealTo(d.id, 'lost')}>
                {t('crm.deals.drawer.markLost')}
              </MenuItem>
            )}
            <MenuItem icon={<Building2 size={15} />} onSelect={() => navigate(`/crm/companies/${d.company}`)}>
              {t('crm.deals.drawer.openCompany')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash2 size={15} />} danger onSelect={() => setConfirmDelete(true)}>
              {t('crm.deals.drawer.deleteDeal')}
            </MenuItem>
          </>
        }
        banner={banner}
        title={d.name}
        onTitleChange={name => update({ name })}
        fields={[
          { icon: GitBranch, label: t('crm.pipelines.pipeline'), value: <PipelineField deal={d} /> },
          { icon: Layers, label: t('crm.deals.col.stage'), value: <StageField deal={d} /> },
          { icon: CircleDollarSign, label: t('crm.deals.col.amount'), value: <AmountInput value={d.amount} onCommit={amount => update({ amount })} /> },
          {
            icon: Percent,
            label: t('crm.deals.drawer.probability'),
            value: open ? (
              <span className="row" style={{ gap: 8, flex: 1, maxWidth: 280 }}>
                <span className="num">{pct(probability(d))}</span>
                <Progress value={probability(d) * 100} aria-label={t('crm.deals.drawer.probabilityAria')} />
                <span className="faint num" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                  {t('crm.deals.drawer.weighted', { amount: money(weighted(d)) })}
                </span>
              </span>
            ) : (
              <span className="muted">{st.category === 'won' ? t('crm.deals.drawer.probWon') : t('crm.deals.drawer.probLost')}</span>
            ),
          },
          {
            icon: CalendarIcon,
            label: open ? t('crm.deals.drawer.expectedClose') : t('crm.deals.drawer.closedOn'),
            value: open ? <DateField value={d.closeDate} onChange={closeDate => update({ closeDate })} label={t('crm.deals.drawer.expectedCloseAria')} /> : <span className="num">{fmtDate(d.closedAt ?? d.closeDate)}</span>,
          },
          { icon: Building2, label: t('crm.deals.col.company'), value: <CompanyLink id={d.company} logo /> },
          { icon: Megaphone, label: t('ads.field.source'), value: <RecordAttribution path={`/deals/${d.id}`} /> },
          {
            icon: Users,
            label: t('crm.deals.drawer.contacts'),
            value: (
              <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                {people.map((c, i) => (
                  <span key={c}>
                    <ContactLink id={c} />
                    {i < people.length - 1 && ','}
                  </span>
                ))}
                <Menu>
                  <MenuTrigger asChild>
                    <button className={people.length ? 'ibtn ibtn-xs' : 'pillbtn empty'} aria-label={t('crm.deals.drawer.editContacts')}>
                      <UserPlus size={13} />
                      {!people.length && t('crm.deals.drawer.addContacts')}
                    </button>
                  </MenuTrigger>
                  <MenuContent>
                    {companyPeople.length ? (
                      companyPeople.map(p => (
                        <MenuCheckboxItem
                          key={p.id}
                          icon={<User size={14} />}
                          checked={d.contacts.includes(p.id)}
                          onCheckedChange={() => update({ contacts: d.contacts.includes(p.id) ? d.contacts.filter(x => x !== p.id) : [...d.contacts, p.id] })}
                          onSelect={e => e.preventDefault()}
                        >
                          {p.name}
                        </MenuCheckboxItem>
                      ))
                    ) : (
                      <MenuItem disabled>{t('crm.deals.drawer.noContacts')}</MenuItem>
                    )}
                  </MenuContent>
                </Menu>
              </span>
            ),
          },
          { icon: User, label: t('crm.deals.col.owner'), value: <OwnerField value={d.owner} onChange={owner => update({ owner })} /> },
          { icon: Clock, label: t('crm.deals.drawer.created'), value: <span className="muted num">{fmtDate(new Date(d.created))}</span> },
          ...customRows.map(r => ({ icon: r.icon, label: r.label, value: r.node })),
        ]}
        tabs={[
          {
            id: 'activity',
            label: t('crm.deals.drawer.tabActivity'),
            count: acts.length,
            content: (
              <>
                <ActivityFeed items={acts} showContact />
                <ActivityComposer deal={d.id} company={d.company} />
              </>
            ),
          },
          {
            id: 'stages',
            label: t('crm.pipelines.history'),
            content: <StageHistory deal={d} />,
          },
          {
            id: 'followups',
            label: t('crm.deals.drawer.tabFollowups'),
            count: follow.filter(a => !a.done).length,
            content: follow.length ? (
              <div className="feed">
                {follow.map(a => (
                  <ActivityRow key={a.id} a={a} />
                ))}
              </div>
            ) : (
              <p className="faint" style={{ fontSize: 13, margin: '10px 0' }}>
                {t('crm.deals.drawer.noFollowups')}
              </p>
            ),
          },
        ]}
      />
      <DeleteDealConfirm
        open={confirmDelete}
        name={d.name}
        count={acts.length}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          dispatch({ type: 'deal/delete', id: d.id });
          ui.closeDrawer();
          toast(t('crm.deals.deleted', { name: d.name }));
        }}
      />
    </>
  );
}

function DeleteDealConfirm({ open, name, count, onCancel, onConfirm }: { open: boolean; name: string; count: number; onCancel: () => void; onConfirm: () => void }) {
  const t = useT();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={o => !o && onCancel()}
      danger
      title={t('crm.deals.drawer.deleteTitle')}
      description={
        <>
          <b>{name}</b> {t('crm.deals.drawer.deleteDesc', { count })}
        </>
      }
      confirmLabel={t('crm.deals.drawer.deleteDeal')}
      cancelLabel={t('crm.common.cancel')}
      onConfirm={onConfirm}
    />
  );
}

export function ContactDrawer({ id }: { id: string }) {
  const { data, dispatch } = useCrm();
  const ui = useCrmUi();
  const navigate = useNavigate();
  const t = useT();
  const c = findContact(data, id);
  if (!c) return null;
  const co = findCompany(data, c.company);
  const ds = dealsOfContact(data, c.id);
  const acts = activitiesOfContact(data, c.id);
  const customRows = useCustomRows('contact', c.custom, patch => dispatch({ type: 'contact/update', id: c.id, patch: { custom: { ...c.custom, ...patch } } }));
  return (
    <EntityDrawer
      label={t('crm.contacts.drawer.contactLabel', { name: c.name })}
      onClose={ui.closeDrawer}
      crumb={
        <>
          {co && (
            <button className="pillbtn" style={{ fontSize: 12.5 }} onClick={() => navigate(`/crm/companies/${co.id}`)}>
              <CompanyLogo name={co.name} size={16} />
              {co.name}
            </button>
          )}
          <span className="faint">/</span>
          <span className="faint" style={{ fontSize: 12, padding: '0 6px' }}>
            {t('crm.contacts.drawer.crumbContact')}
          </span>
        </>
      }
      actions={
        <Button size="sm" variant="ghost" onClick={() => ui.newDeal({ company: c.company, owner: c.owner })}>
          <CircleDollarSign size={14} />
          <span className="hide-m">{t('crm.deals.newDeal')}</span>
        </Button>
      }
      title={c.name}
      onTitleChange={name => dispatch({ type: 'contact/update', id: c.id, patch: { name } })}
      subtitle={c.title}
      fields={[
        { icon: Building2, label: t('crm.companies.col.company'), value: <CompanyLink id={c.company} logo /> },
        { icon: Briefcase, label: t('crm.contacts.col.title'), value: c.title ? <span>{c.title}</span> : <span className="faint">—</span> },
        { icon: Mail, label: t('crm.contacts.col.email'), value: c.email ? <a className="crm-link" href={`mailto:${c.email}`}>{c.email}</a> : <span className="faint">—</span> },
        { icon: Phone, label: t('crm.contacts.col.phone'), value: c.phone ? <span className="num">{c.phone}</span> : <span className="faint">—</span> },
        { icon: User, label: t('crm.deals.col.owner'), value: <OwnerField value={c.owner} onChange={owner => dispatch({ type: 'contact/update', id: c.id, patch: { owner } })} /> },
        ...customRows.map(r => ({ icon: r.icon, label: r.label, value: r.node })),
      ]}
      tabs={[
        {
          id: 'activity',
          label: t('crm.deals.drawer.tabActivity'),
          count: acts.length,
          content: (
            <>
              <ActivityFeed items={acts} showDeal showContact={false} />
              <ActivityComposer contact={c.id} company={c.company} />
            </>
          ),
        },
        {
          id: 'deals',
          label: t('crm.deals.drawer.tabDeals'),
          count: ds.length,
          content: ds.length ? (
            <div>
              {ds.map(x => (
                <div key={x.id} className="row" style={{ height: 34, fontSize: 13, gap: 10 }}>
                  <StageIcon stage={x.stage} />
                  <span className="grow trunc" style={{ flex: 1 }}>
                    <DealLink id={x.id} />
                  </span>
                  <span className="num muted">{money(x.amount)}</span>
                  <span className="muted hide-m" style={{ width: 84 }}>
                    {stageName(x.stage, stage(x.stage).name)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="faint" style={{ fontSize: 13, margin: '10px 0' }}>
              {t('crm.contacts.drawer.noDeals')}
            </p>
          ),
        },
        {
          id: 'appointments',
          label: t('appt.client.title'),
          content: <ClientAppointments contactId={c.id} />,
        },
      ]}
    />
  );
}
