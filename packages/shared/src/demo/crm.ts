/* Демо-данные CRM: 12 компаний, 26 контактов, 32 сделки, 65 активностей.
   Все даты считаются от сегодняшнего дня, поэтому дашборд всегда выглядит «живым». Владельцы — участники основного seed (m1…m7). */
import { dOff, iso, today } from './dates';
import type { ActivityType, Company, Contact, CrmActivity, CrmData, Deal, IsoDate, StageId } from '../domain';

const DAY = 864e5;
const ago = (days: number) => Date.now() - days * DAY;

/** Дата в месяце «n месяцев назад»; будущие даты текущего месяца подрезаются до сегодня */
function inMonth(monthsAgo: number, day: number): IsoDate {
  const t = today();
  const first = new Date(t.getFullYear(), t.getMonth() - monthsAgo, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const d = new Date(first.getFullYear(), first.getMonth(), Math.min(day, last));
  return iso(d > t ? t : d);
}

const COMPANIES: [string, string, string, string, string, string][] = [
  // id, название, отрасль, размер, владелец, город
  ['co1', 'Northwind Logistics', 'Logistics', '201–1000', 'm3', 'Rotterdam'],
  ['co2', 'Helio Energy', 'Energy', '1000+', 'm4', 'Austin'],
  ['co3', 'Brightpath Health', 'Healthcare', '201–1000', 'm2', 'Boston'],
  ['co4', 'Quanta Retail', 'Retail', '1000+', 'm6', 'Chicago'],
  ['co5', 'Lumen Financial', 'Fintech', '51–200', 'm7', 'London'],
  ['co6', 'Orbital Media', 'Media', '51–200', 'm1', 'Los Angeles'],
  ['co7', 'Verdant Foods', 'Food & Beverage', '201–1000', 'm4', 'Portland'],
  ['co8', 'Atlas Manufacturing', 'Manufacturing', '1000+', 'm3', 'Stuttgart'],
  ['co9', 'Pinecrest Education', 'Education', '11–50', 'm2', 'Toronto'],
  ['co10', 'Skyline Realty', 'Real Estate', '51–200', 'm6', 'Miami'],
  ['co11', 'Cobalt Software', 'Software', '11–50', 'm7', 'Berlin'],
  ['co12', 'Meridian Travel', 'Travel', '201–1000', 'm1', 'Lisbon'],
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

const CONTACTS: [string, string, string][] = [
  // компания, имя, должность (id — ct1…ct26 по порядку)
  ['co1', 'Henrik Visser', 'VP Operations'],
  ['co1', 'Mia de Jong', 'Head of IT'],
  ['co2', 'Carlos Mendez', 'Director of Digital'],
  ['co2', 'Rachel Kim', 'Procurement Manager'],
  ['co2', 'Owen Brooks', 'CTO'],
  ['co3', 'Alicia Moore', 'Chief Medical Officer'],
  ['co3', 'Daniel Cho', 'IT Director'],
  ['co4', 'Natalie Brooks', 'VP E-commerce'],
  ['co4', 'Tom Hargrove', 'Head of Analytics'],
  ['co5', 'Sofia Rossi', 'COO'],
  ['co5', 'Ben Adler', 'Head of Product'],
  ['co5', 'Yuki Tanaka', 'CFO'],
  ['co6', 'Jordan Blake', 'Head of Production'],
  ['co6', 'Ines Duarte', 'Marketing Director'],
  ['co7', 'Greta Olsen', 'Supply Chain Lead'],
  ['co7', 'Paul Mercer', 'CEO'],
  ['co8', 'Klaus Brandt', 'Plant Director'],
  ['co8', 'Anja Weber', 'Procurement Lead'],
  ['co9', 'Maya Singh', 'Dean of Digital Learning'],
  ['co9', "Liam O'Connor", 'IT Manager'],
  ['co10', 'Victor Alonso', 'Managing Partner'],
  ['co10', 'Chloe Martin', 'Marketing Manager'],
  ['co11', 'Felix Hartmann', 'CEO'],
  ['co11', 'Nina Kovac', 'CTO'],
  ['co12', 'Isabel Costa', 'Head of Distribution'],
  ['co12', 'Rui Almeida', 'Revenue Manager'],
];

type DealRow = [string, string, string[], string, number, StageId, number | [number, number], number, string?];
// название, компания, контакты, владелец, сумма, этап, срок (дней от сегодня; для Won/Lost — [месяцев назад, число]), создана (дней назад), причина проигрыша
const DEALS: DealRow[] = [
  ['Fleet analytics pilot', 'co1', ['ct1'], 'm3', 28000, 'lead', 45, 6],
  ['Smart meter dashboard', 'co2', ['ct3'], 'm4', 42000, 'lead', 60, 4],
  ['Patient portal discovery', 'co3', ['ct7'], 'm2', 18500, 'lead', 38, 9],
  ['Loyalty app prototype', 'co4', ['ct9'], 'm6', 24000, 'lead', 52, 3],
  ['Creator workflow audit', 'co6', ['ct14'], 'm1', 12000, 'lead', 30, 11],
  ['Route optimisation engine', 'co1', ['ct1', 'ct2'], 'm3', 96000, 'qualified', 35, 20],
  ['Grid forecasting module', 'co2', ['ct4', 'ct5'], 'm4', 150000, 'qualified', 50, 18],
  ['Clinic scheduling app', 'co3', ['ct6'], 'm2', 64000, 'qualified', 28, 22],
  ['Spend insights for SMEs', 'co5', ['ct10', 'ct11'], 'm7', 55000, 'qualified', 33, 15],
  ['Farm-to-shelf tracking', 'co7', ['ct15'], 'm4', 38000, 'qualified', 40, 14],
  ['Campus mobile app', 'co9', ['ct19'], 'm2', 29000, 'qualified', 25, 19],
  ['Warehouse control tower', 'co8', ['ct17', 'ct18'], 'm3', 175000, 'proposal', 21, 35],
  ['Omnichannel storefront', 'co4', ['ct8', 'ct9'], 'm6', 120000, 'proposal', 18, 30],
  ['Risk dashboard', 'co5', ['ct12'], 'm7', 72000, 'proposal', 14, 26],
  ['Booking engine refresh', 'co12', ['ct25'], 'm1', 88000, 'proposal', 20, 32],
  ['Listings portal redesign', 'co10', ['ct21'], 'm6', 46000, 'proposal', 16, 27],
  ['Production scheduling suite', 'co8', ['ct17'], 'm3', 132000, 'negotiation', 9, 60],
  ['Telehealth platform', 'co3', ['ct6', 'ct7'], 'm2', 98000, 'negotiation', 6, 55],
  ['Revenue management tool', 'co12', ['ct26'], 'm1', 54000, 'negotiation', 12, 48],
  ['Streaming asset manager', 'co6', ['ct13', 'ct14'], 'm1', 76000, 'negotiation', 4, 52],
  ['Developer docs platform', 'co11', ['ct23', 'ct24'], 'm7', 34000, 'negotiation', -3, 58],
  ['Dispatch mobile app', 'co1', ['ct2'], 'm3', 68000, 'won', [0, 6], 70],
  ['Learning analytics', 'co9', ['ct19', 'ct20'], 'm2', 41000, 'won', [0, 12], 64],
  ['Brand microsite', 'co6', ['ct13'], 'm1', 22000, 'won', [1, 9], 80],
  ['Store ops dashboard', 'co4', ['ct8'], 'm6', 94000, 'won', [1, 21], 95],
  ['Payments onboarding', 'co5', ['ct10'], 'm7', 58000, 'won', [2, 14], 110],
  ['Inventory forecasting', 'co7', ['ct16'], 'm4', 47000, 'won', [3, 11], 130],
  ['Energy portal', 'co2', ['ct3'], 'm4', 115000, 'won', [4, 18], 150],
  ['Property CRM sync', 'co10', ['ct22'], 'm6', 31000, 'won', [5, 8], 170],
  ['Plant IoT gateway', 'co8', ['ct18'], 'm3', 84000, 'lost', [1, 15], 100, 'Chose a competitor'],
  ['Member app', 'co12', ['ct25'], 'm1', 26000, 'lost', [2, 5], 120, 'No budget'],
  ['Docs migration', 'co11', ['ct24'], 'm7', 19000, 'lost', [0, 4], 75, 'Bad timing'],
];

type ActRow = [ActivityType, string, string, string | null, string, number, { due?: number; done?: boolean; body?: string }?];
// тип, тема, сделка (d… — компания берётся из сделки) или компания (co…), контакт, автор, минут назад
const ACTIVITIES: ActRow[] = [
  ['call', 'Intro call — fleet visibility pain points', 'd1', 'ct1', 'm3', 4 * 1440 + 200],
  ['email', 'Sent case study on route savings', 'd1', 'ct1', 'm3', 3 * 1440 + 90],
  ['note', 'Henrik wants a 6-week pilot', 'd1', null, 'm3', 1440 + 300, { body: 'Pilot on ~40 vehicles in the Benelux region. Needs a data-sharing agreement before starting.' }],
  ['task', 'Send pilot scope and pricing', 'd1', null, 'm3', 40, { due: 2 }],
  ['call', 'Discovery call with Carlos', 'd2', 'ct3', 'm4', 2 * 1440 + 120],
  ['email', 'Shared smart meter dashboard demo link', 'd2', 'ct3', 'm4', 1440 + 500],
  ['task', 'Book technical deep-dive', 'd2', null, 'm4', 200, { due: 1 }],
  ['meeting', 'Discovery workshop with clinical ops', 'd3', 'ct7', 'm2', 7 * 1440],
  ['note', 'Portal must integrate with the existing EHR', 'd3', null, 'm2', 6 * 1440, { body: 'Epic is the system of record. Single sign-on through Azure AD is a must-have.' }],
  ['call', 'Follow-up on loyalty app interest', 'd4', 'ct9', 'm6', 2 * 1440 + 60],
  ['email', 'Intro email and company deck', 'd4', 'ct9', 'm6', 3 * 1440 + 40],
  ['email', 'Sent workflow audit checklist', 'd5', 'ct14', 'm1', 9 * 1440],
  ['call', 'Qualification call — budget confirmed', 'd6', 'ct1', 'm3', 12 * 1440],
  ['meeting', 'Solution walkthrough with the ops team', 'd6', 'ct1', 'm3', 8 * 1440 + 240],
  ['email', 'Sent technical requirements document', 'd6', 'ct2', 'm3', 5 * 1440 + 300],
  ['task', 'Prepare ROI model for the routing engine', 'd6', null, 'm3', 1440 + 100, { due: 3 }],
  ['meeting', 'Kick-off with Owen Brooks (CTO)', 'd7', 'ct5', 'm4', 14 * 1440],
  ['call', 'Procurement requirements call', 'd7', 'ct4', 'm4', 9 * 1440 + 30],
  ['note', 'Needs an on-prem option for data residency', 'd7', null, 'm4', 6 * 1440 + 500, { body: 'Legal requires that raw meter data never leaves the EU region. Discuss hybrid deployment with engineering.' }],
  ['email', 'Shared security questionnaire answers', 'd7', 'ct4', 'm4', 2 * 1440 + 200],
  ['task', 'Send NDA for signature', 'd7', null, 'm4', 8 * 1440, { due: -7, done: true }],
  ['call', 'Scoping call — scheduling flows', 'd8', 'ct6', 'm2', 11 * 1440],
  ['meeting', 'Demo for clinic managers', 'd8', 'ct6', 'm2', 4 * 1440 + 100],
  ['task', 'Send updated estimate', 'd8', null, 'm2', 2 * 1440, { due: -1 }],
  ['call', 'Intro call with Sofia', 'd9', 'ct10', 'm7', 10 * 1440 + 60],
  ['email', 'Sent API integration overview', 'd9', 'ct11', 'm7', 6 * 1440],
  ['meeting', 'Product demo for the finance team', 'd9', 'ct10', 'm7', 3 * 1440 + 400],
  ['call', 'Supply chain pain points', 'd10', 'ct15', 'm4', 12 * 1440],
  ['note', 'Pilot with 3 distribution centres possible in Q1', 'd10', null, 'm4', 10 * 1440],
  ['email', 'Sent campus app mockups', 'd11', 'ct19', 'm2', 5 * 1440],
  ['call', 'Feedback call on the mockups', 'd11', 'ct19', 'm2', 2 * 1440 + 40],
  ['meeting', 'Executive presentation — control tower', 'd12', 'ct17', 'm3', 8 * 1440],
  ['email', 'Sent proposal v1', 'd12', 'ct18', 'm3', 5 * 1440 + 60],
  ['call', 'Walkthrough of pricing tiers', 'd12', 'ct18', 'm3', 2 * 1440 + 300],
  ['task', 'Follow up on proposal feedback', 'd12', null, 'm3', 1440, { due: 0 }],
  ['meeting', 'Proposal review with Natalie', 'd13', 'ct8', 'm6', 6 * 1440 + 200],
  ['email', 'Sent revised scope with phased rollout', 'd13', 'ct9', 'm6', 3 * 1440 + 150],
  ['note', 'Competing quote from a large consultancy', 'd13', null, 'm6', 4 * 1440, { body: 'They are anchored on a fixed-price offer that is ~15% lower but excludes integrations.' }],
  ['task', 'Share pricing sheet', 'd13', null, 'm6', 5 * 1440, { due: -2, done: true }],
  ['call', 'Risk model Q&A', 'd14', 'ct12', 'm7', 7 * 1440],
  ['email', 'Sent proposal and timeline', 'd14', 'ct12', 'm7', 4 * 1440 + 500],
  ['meeting', 'Proposal presentation in Lisbon', 'd15', 'ct25', 'm1', 9 * 1440 + 300],
  ['email', 'Sent booking engine architecture options', 'd15', 'ct25', 'm1', 5 * 1440 + 120],
  ['call', 'Check-in on the proposal', 'd16', 'ct21', 'm6', 3 * 1440 + 20],
  ['meeting', 'Negotiation: scope and payment terms', 'd17', 'ct17', 'm3', 2 * 1440 + 80],
  ['call', 'Legal review kick-off', 'd17', 'ct17', 'm3', 1440 + 60],
  ['note', 'Customer asks for 8% off the annual licence', 'd17', null, 'm3', 1440 + 20],
  ['task', 'Send revised contract', 'd17', null, 'm3', 300, { due: 1 }],
  ['meeting', 'Contract walkthrough', 'd18', 'ct6', 'm2', 3 * 1440 + 200],
  ['email', 'Sent redlined MSA', 'd18', 'ct7', 'm2', 1440 + 350],
  ['call', 'Pricing negotiation call', 'd19', 'ct26', 'm1', 2 * 1440 + 10],
  ['meeting', 'Final demo to leadership', 'd20', 'ct13', 'm1', 5 * 1440],
  ['email', 'Sent order form for signature', 'd20', 'ct14', 'm1', 190],
  ['call', 'Chasing the signature', 'd21', 'ct23', 'm7', 4 * 1440 + 60],
  ['note', 'Champion is on leave until next week', 'd21', null, 'm7', 2 * 1440 + 400],
  ['task', 'Re-engage Nina on pricing', 'd21', null, 'm7', 3 * 1440, { due: -2 }],
  ['meeting', 'Closing call — contract signed', 'd22', 'ct2', 'm3', 6 * 1440],
  ['email', 'Welcome kit and onboarding plan', 'd22', 'ct2', 'm3', 5 * 1440],
  ['note', 'Signed a 12-month contract', 'd23', null, 'm2', 10 * 1440],
  ['call', 'Kick-off call', 'd23', 'ct20', 'm2', 9 * 1440],
  ['note', 'Lost to the incumbent vendor on price', 'd30', null, 'm3', 30 * 1440],
  ['email', 'Thanks for the opportunity — closing out', 'd31', 'ct25', 'm1', 70 * 1440],
  ['task', 'Send quarterly check-in to Atlas', 'co8', null, 'm3', 8 * 1440, { due: -5, done: true }],
  ['call', 'Account review call', 'co2', null, 'm4', 20 * 1440],
  ['note', 'Helio plans its FY budget in November', 'co2', null, 'm4', 15 * 1440],
  ['meeting', 'QBR with Pinecrest leadership', 'co9', null, 'm2', 18 * 1440],
  ['task', 'Send holiday gifts to key contacts', 'co4', null, 'm6', 1440, { due: 14 }],
];

export function seedCrm(): CrmData {
  const companies: Company[] = COMPANIES.map(([id, name, industry, size, owner, city], i) => ({
    id,
    name,
    industry,
    size,
    owner,
    city,
    website: `${slug(name.split(' ')[0])}.com`,
    created: ago(200 + i * 9),
  }));

  const contacts: Contact[] = CONTACTS.map(([company, name, title], i) => {
    const co = companies.find(c => c.id === company)!;
    const [first, ...rest] = name.replace(/[.']/g, '').toLowerCase().split(' ');
    return {
      id: `ct${i + 1}`,
      company,
      name,
      title,
      owner: co.owner,
      email: `${first}.${rest.join('')}@${co.website}`,
      phone: `+1 (555) 01${String(10 + i * 3).padStart(2, '0')}-${String(2000 + i * 137).slice(-4)}`,
      created: ago(180 - i * 4),
    };
  });

  const deals: Deal[] = DEALS.map(([name, company, cs, owner, amount, stage, when, created, lostReason], i) => {
    const closed = Array.isArray(when);
    const date = closed ? inMonth(when[0], when[1]) : dOff(when);
    return {
      id: `d${i + 1}`,
      name,
      company,
      contacts: cs,
      owner,
      amount,
      stage,
      closeDate: date,
      created: ago(created),
      closedAt: closed ? date : undefined,
      lostReason,
      order: i,
    };
  });

  const dealCompany = (id: string) => deals.find(d => d.id === id)?.company;
  const activities: CrmActivity[] = ACTIVITIES.map(([type, subject, ref, contact, by, mins, extra], i) => {
    const isDeal = /^d\d/.test(ref);
    return {
      id: `ac${i + 1}`,
      type,
      subject,
      deal: isDeal ? ref : undefined,
      company: isDeal ? dealCompany(ref) : ref,
      contact: contact ?? undefined,
      by,
      at: Date.now() - mins * 6e4,
      due: extra?.due != null ? dOff(extra.due) : undefined,
      done: type === 'task' ? !!extra?.done : undefined,
      body: extra?.body,
    };
  }).sort((a, b) => b.at - a.at);

  return { companies, contacts, deals, activities };
}
