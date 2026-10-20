/* Справочники CRM: этапы воронки, типы активностей, отрасли, размеры компаний, причины проигрыша */
import { CircleCheck, Mail, Phone, StickyNote, Users, type LucideIcon } from 'lucide-react';
import type { ActivityType, StageId } from './types';

export const STAGES: { id: StageId; name: string; p: number; c: string }[] = [
  { id: 'lead', name: 'Lead', p: 0.1, c: 'var(--gray)' },
  { id: 'qualified', name: 'Qualified', p: 0.25, c: 'var(--blue)' },
  { id: 'proposal', name: 'Proposal', p: 0.5, c: 'var(--violet)' },
  { id: 'negotiation', name: 'Negotiation', p: 0.75, c: 'var(--amber)' },
  { id: 'won', name: 'Won', p: 1, c: 'var(--green)' },
  { id: 'lost', name: 'Lost', p: 0, c: 'var(--red)' },
];

export const stage = (id: StageId) => STAGES.find(s => s.id === id)!;
export const isOpen = (id: StageId) => id !== 'won' && id !== 'lost';
export const OPEN_STAGES = STAGES.filter(s => isOpen(s.id));

export const ACTIVITY_TYPES: { id: ActivityType; name: string; plural: string; verb: string; icon: LucideIcon }[] = [
  { id: 'call', name: 'Call', plural: 'Calls', verb: 'logged a call', icon: Phone },
  { id: 'email', name: 'Email', plural: 'Emails', verb: 'sent an email', icon: Mail },
  { id: 'meeting', name: 'Meeting', plural: 'Meetings', verb: 'held a meeting', icon: Users },
  { id: 'note', name: 'Note', plural: 'Notes', verb: 'added a note', icon: StickyNote },
  { id: 'task', name: 'Follow-up', plural: 'Follow-ups', verb: 'scheduled a follow-up', icon: CircleCheck },
];
export const activityType = (id: ActivityType) => ACTIVITY_TYPES.find(t => t.id === id)!;

export const INDUSTRIES = ['Logistics', 'Energy', 'Healthcare', 'Retail', 'Fintech', 'Media', 'Food & Beverage', 'Manufacturing', 'Education', 'Real Estate', 'Software', 'Travel'];
export const SIZES = ['1–10', '11–50', '51–200', '201–1000', '1000+'];
export const LOST_REASONS = ['Price too high', 'Chose a competitor', 'No budget', 'No decision', 'Bad timing', 'Requirements changed'];
