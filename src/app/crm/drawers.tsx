/* Карточки сделки и контакта — EntityDrawer с полями CRM */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { Building2, Calendar as CalendarIcon, CircleCheck, CircleDollarSign, Clock, ClockAlert, Mail, Percent, Phone, RotateCcw, Trash2, User, UserPlus, Users, Briefcase, Layers, X } from 'lucide-react';
import { Button, ConfirmDialog, Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Progress, toast } from '@/components/ui';
import { EntityDrawer } from '@/components/gr8r/entity-drawer';
import { diffDays, fmtDate, parse, today } from '../lib/dates';
import { ActivityComposer, ActivityFeed, ActivityRow, CompanyLink, CompanyLogo, ContactLink, DateField, DealLink, OwnerField, StageField, StageIcon } from './components';
import { money, pct } from './format';
import { activitiesOfContact, activitiesOfDeal, company as findCompany, contact as findContact, contactsOfCompany, dealsOfContact, deal as findDeal, isOverdueDeal, probability, weighted } from './selectors';
import { isOpen, stage } from './stages';
import { useCrm, type DealPatch } from './store';
import { useCrmUi } from './ui-context';

/** Сумма сделки: поле ввода без рамки, сохраняется по Enter или потере фокуса */
function AmountInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  return (
    <input
      key={value}
      className="crm-inline"
      inputMode="decimal"
      defaultValue={money(value)}
      aria-label="Amount in USD"
      onFocus={e => {
        e.currentTarget.value = String(value);
        e.currentTarget.select();
      }}
      onBlur={e => {
        const v = Number(e.currentTarget.value.replace(/[^0-9.]/g, ''));
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
  const { data, dispatch } = useCrm();
  const ui = useCrmUi();
  const navigate = useNavigate();
  const d = findDeal(data, id);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  if (!d) return null;
  const co = findCompany(data, d.company);
  const open = isOpen(d.stage);
  const acts = activitiesOfDeal(data, d.id);
  const follow = acts.filter(a => a.type === 'task');
  const overdueDays = isOverdueDeal(d) ? -diffDays(parse(d.closeDate), today()) : 0;
  const people = d.contacts.filter(c => findContact(data, c));
  const companyPeople = contactsOfCompany(data, d.company);
  const update = (patch: DealPatch) => dispatch({ type: 'deal/update', id: d.id, patch });

  const banner =
    d.stage === 'won' ? (
      <div className="alert ok">
        <CircleCheck size={15} />
        <span>
          Won {d.closedAt ? `on ${fmtDate(d.closedAt)}` : ''} for {money(d.amount)}.{' '}
          <button className="link" onClick={() => ui.moveDeal(d.id, 'negotiation')}>
            Reopen deal
          </button>
        </span>
      </div>
    ) : d.stage === 'lost' ? (
      <div className="alert danger">
        <X size={15} />
        <span>
          Lost{d.closedAt ? ` on ${fmtDate(d.closedAt)}` : ''}
          {d.lostReason ? `: ${d.lostReason}` : ''}.{' '}
          <button className="link" onClick={() => ui.moveDeal(d.id, 'qualified')}>
            Reopen deal
          </button>
        </span>
      </div>
    ) : overdueDays > 0 ? (
      <div className="alert danger">
        <ClockAlert size={15} />
        <span>
          Expected close date passed {overdueDays} day{overdueDays > 1 ? 's' : ''} ago. Pick a new date below.
        </span>
      </div>
    ) : null;

  return (
    <>
      <EntityDrawer
        label={`Deal: ${d.name}`}
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
              Deal
            </span>
          </>
        }
        actions={
          open ? (
            <Button size="sm" variant="ghost" onClick={() => ui.moveDeal(d.id, 'won')}>
              <CircleCheck size={14} />
              <span className="hide-m">Mark won</span>
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => ui.moveDeal(d.id, d.stage === 'won' ? 'negotiation' : 'qualified')}>
              <RotateCcw size={14} />
              <span className="hide-m">Reopen</span>
            </Button>
          )
        }
        menu={
          <>
            {open && (
              <MenuItem icon={<X size={15} />} onSelect={() => ui.moveDeal(d.id, 'lost')}>
                Mark as lost
              </MenuItem>
            )}
            <MenuItem icon={<Building2 size={15} />} onSelect={() => navigate(`/crm/companies/${d.company}`)}>
              Open company
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash2 size={15} />} danger onSelect={() => setConfirmDelete(true)}>
              Delete deal
            </MenuItem>
          </>
        }
        banner={banner}
        title={d.name}
        onTitleChange={name => update({ name })}
        fields={[
          { icon: Layers, label: 'Stage', value: <StageField deal={d} /> },
          { icon: CircleDollarSign, label: 'Amount', value: <AmountInput value={d.amount} onCommit={amount => update({ amount })} /> },
          {
            icon: Percent,
            label: 'Probability',
            value: open ? (
              <span className="row" style={{ gap: 8, flex: 1, maxWidth: 280 }}>
                <span className="num">{pct(probability(d))}</span>
                <Progress value={probability(d) * 100} aria-label="Win probability" />
                <span className="faint num" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                  {money(weighted(d))} weighted
                </span>
              </span>
            ) : (
              <span className="muted">{d.stage === 'won' ? '100% — closed won' : '0% — closed lost'}</span>
            ),
          },
          {
            icon: CalendarIcon,
            label: open ? 'Expected close' : 'Closed on',
            value: open ? <DateField value={d.closeDate} onChange={closeDate => update({ closeDate })} label="Expected close date" /> : <span className="num">{fmtDate(d.closedAt ?? d.closeDate)}</span>,
          },
          { icon: Building2, label: 'Company', value: <CompanyLink id={d.company} logo /> },
          {
            icon: Users,
            label: 'Contacts',
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
                    <button className={people.length ? 'ibtn ibtn-xs' : 'pillbtn empty'} aria-label="Edit contacts">
                      <UserPlus size={13} />
                      {!people.length && 'Add contacts'}
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
                      <MenuItem disabled>No contacts at this company</MenuItem>
                    )}
                  </MenuContent>
                </Menu>
              </span>
            ),
          },
          { icon: User, label: 'Owner', value: <OwnerField value={d.owner} onChange={owner => update({ owner })} /> },
          { icon: Clock, label: 'Created', value: <span className="muted num">{fmtDate(new Date(d.created))}</span> },
        ]}
        tabs={[
          {
            id: 'activity',
            label: 'Activity',
            count: acts.length,
            content: (
              <>
                <ActivityFeed items={acts} showContact />
                <ActivityComposer deal={d.id} company={d.company} />
              </>
            ),
          },
          {
            id: 'followups',
            label: 'Follow-ups',
            count: follow.filter(a => !a.done).length,
            content: follow.length ? (
              <div className="feed">
                {follow.map(a => (
                  <ActivityRow key={a.id} a={a} />
                ))}
              </div>
            ) : (
              <p className="faint" style={{ fontSize: 13, margin: '10px 0' }}>
                No follow-ups yet. Choose “Follow-up” in the composer on the Activity tab.
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
          toast(`Deleted “${d.name}”`);
        }}
      />
    </>
  );
}

function DeleteDealConfirm({ open, name, count, onCancel, onConfirm }: { open: boolean; name: string; count: number; onCancel: () => void; onConfirm: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={o => !o && onCancel()}
      danger
      title="Delete deal?"
      description={
        <>
          <b>{name}</b> and its {count} activit{count === 1 ? 'y' : 'ies'} will be permanently deleted.
        </>
      }
      confirmLabel="Delete deal"
      cancelLabel="Cancel"
      onConfirm={onConfirm}
    />
  );
}

export function ContactDrawer({ id }: { id: string }) {
  const { data, dispatch } = useCrm();
  const ui = useCrmUi();
  const navigate = useNavigate();
  const c = findContact(data, id);
  if (!c) return null;
  const co = findCompany(data, c.company);
  const ds = dealsOfContact(data, c.id);
  const acts = activitiesOfContact(data, c.id);
  return (
    <EntityDrawer
      label={`Contact: ${c.name}`}
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
            Contact
          </span>
        </>
      }
      actions={
        <Button size="sm" variant="ghost" onClick={() => ui.newDeal({ company: c.company, owner: c.owner })}>
          <CircleDollarSign size={14} />
          <span className="hide-m">New deal</span>
        </Button>
      }
      title={c.name}
      onTitleChange={name => dispatch({ type: 'contact/update', id: c.id, patch: { name } })}
      subtitle={c.title}
      fields={[
        { icon: Building2, label: 'Company', value: <CompanyLink id={c.company} logo /> },
        { icon: Briefcase, label: 'Title', value: c.title ? <span>{c.title}</span> : <span className="faint">—</span> },
        { icon: Mail, label: 'Email', value: c.email ? <a className="crm-link" href={`mailto:${c.email}`}>{c.email}</a> : <span className="faint">—</span> },
        { icon: Phone, label: 'Phone', value: c.phone ? <span className="num">{c.phone}</span> : <span className="faint">—</span> },
        { icon: User, label: 'Owner', value: <OwnerField value={c.owner} onChange={owner => dispatch({ type: 'contact/update', id: c.id, patch: { owner } })} /> },
      ]}
      tabs={[
        {
          id: 'activity',
          label: 'Activity',
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
          label: 'Deals',
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
                    {stage(x.stage).name}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="faint" style={{ fontSize: 13, margin: '10px 0' }}>
              This contact isn’t linked to any deals yet.
            </p>
          ),
        },
      ]}
    />
  );
}
