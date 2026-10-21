/* Разделы настроек — порт SET_NAV и SHORTCUTS из pages/settings.js и overlays/modals.js */
import { AtSign, Building2, Warehouse, Database, Factory, Clock, CreditCard, FolderKanban, Gem, Keyboard, KeyRound, Languages, Mail, MonitorSmartphone, Palette, Receipt, Shield, ShieldCheck, Smartphone, SlidersHorizontal, Tags, User, UserCheck, Users, UsersRound, type LucideIcon } from 'lucide-react';
import { MOD } from '../lib/platform';

export const SET_NAV: [string, [id: string, name: string, icon: LucideIcon][]][] = [
  [
    'General',
    [
      ['workspace', 'Workspace', Building2],
      ['appearance', 'Appearance', Palette],
      ['language', 'Language', Languages],
      ['datetime', 'Date & time', Clock],
    ],
  ],
  [
    'Workspace',
    [
      ['members', 'Members', Users],
      ['teams', 'Teams', UsersRound],
      ['projects', 'Projects', FolderKanban],
      ['permissions', 'Permissions', Shield],
      ['data-model', 'Data model', Database],
      ['production', 'Production', Factory],
      ['organizations', 'Organizations', Building2],
      ['warehouses', 'Warehouses', Warehouse],
      ['cost-items', 'Cost items', Tags],
    ],
  ],
  [
    'Notifications',
    [
      ['notif-email', 'Email', Mail],
      ['notif-push', 'Push', Smartphone],
      ['notif-mentions', 'Mentions', AtSign],
      ['notif-assign', 'Task assignments', UserCheck],
    ],
  ],
  [
    'Personal',
    [
      ['profile', 'Profile', User],
      ['preferences', 'Preferences', SlidersHorizontal],
      ['shortcuts', 'Keyboard shortcuts', Keyboard],
    ],
  ],
  [
    'Security',
    [
      ['password', 'Password', KeyRound],
      ['sessions', 'Sessions', MonitorSmartphone],
      ['2fa', 'Two-factor authentication', ShieldCheck],
    ],
  ],
  [
    'Billing',
    [
      ['plan', 'Plan', Gem],
      ['payment', 'Payment', CreditCard],
      ['invoices', 'Invoices', Receipt],
    ],
  ],
];

export const DEFAULT_SECTION = 'appearance';
export const SET_SECTIONS = SET_NAV.flatMap(g => g[1]);

export const SHORTCUTS: [string, [string, string[]][]][] = [
  [
    'General',
    [
      ['Command menu', [MOD, 'K']],
      ['Search', ['/']],
      ['Keyboard shortcuts', ['?']],
      ['Toggle sidebar', ['[']],
      ['Toggle dark mode', [MOD, 'Shift', 'L']],
      ['Close panel or dialog', ['Esc']],
    ],
  ],
  [
    'Create',
    [
      ['New task', ['N']],
      ['New project', ['P']],
      ['Submit form', [MOD, '↵']],
      ['Send comment', [MOD, '↵']],
    ],
  ],
  [
    'Navigate',
    [
      ['Go to Home', ['G', 'H']],
      ['Go to My Tasks', ['G', 'T']],
      ['Go to Projects', ['G', 'P']],
      ['Go to Inbox', ['G', 'I']],
      ['Go to Calendar', ['G', 'C']],
      ['Go to Settings', ['G', 'S']],
    ],
  ],
  [
    'Command menu',
    [
      ['Move selection', ['↑', '↓']],
      ['Run command', ['↵']],
      ['Search mode', ['Tab']],
    ],
  ],
];
