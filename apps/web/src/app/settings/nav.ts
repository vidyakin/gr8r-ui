/* Разделы настроек — порт SET_NAV и SHORTCUTS из pages/settings.js и overlays/modals.js.
   Строки здесь — ключи словаря, в UI переводятся через t('settings.nav.groups.<group>'|'settings.nav.items.<item>'|'settings.shortcuts.groups.<group>'|'settings.shortcuts.items.<item>').
   id — сегмент URL (routes.ts), оставлены kebab-case и цифры как было. */
import { Inbox, Layers, CircleX, GitBranch, Plug, Globe, ListOrdered, AtSign, BriefcaseBusiness, Shapes, Building2, Warehouse, ClipboardList, Database, Factory, Clock, CreditCard, FolderKanban, Gem, Keyboard, KeyRound, Languages, Mail, Megaphone, MonitorSmartphone, Palette, Receipt, Server, Shield, ShieldCheck, Smartphone, SlidersHorizontal, Tags, Truck, User, UserCheck, Users, UsersRound, type LucideIcon } from 'lucide-react';
import { MOD } from '../lib/platform';

export const SET_NAV: [string, [id: string, nameKey: string, icon: LucideIcon][]][] = [
  [
    'general',
    [
      ['workspace', 'workspace', Building2],
      ['appearance', 'appearance', Palette],
      ['language', 'language', Languages],
      ['datetime', 'datetime', Clock],
    ],
  ],
  [
    'workspace',
    [
      ['members', 'members', Users],
      ['teams', 'teams', UsersRound],
      ['projects', 'projects', FolderKanban],
      ['permissions', 'permissions', Shield],
      ['data-model', 'dataModel', Database],
      ['production', 'production', Factory],
      ['organizations', 'organizations', Building2],
      ['warehouses', 'warehouses', Warehouse],
      ['cost-items', 'costItems', Tags],
      ['work-orders', 'workOrders', ClipboardList],
      ['delivery-methods', 'deliveryMethods', Truck],
      ['positions', 'positions', BriefcaseBusiness],
      ['product-kinds', 'productKinds', Shapes],
      ['deal-pipelines', 'dealPipelines', GitBranch],
      ['lost-reasons', 'lostReasons', CircleX],
      ['lead-statuses', 'leadStatuses', ListOrdered],
      ['lead-forms', 'leadForms', Globe],
      ['lead-sources', 'leadSources', Megaphone],
      ['integrations', 'integrations', Plug],
    ],
  ],
  [
    'notifications',
    [
      ['notif-assign', 'notifAssign', UserCheck],
    ],
  ],
  [
    'personal',
    [
      ['profile', 'profile', User],
      ['preferences', 'preferences', SlidersHorizontal],
      ['shortcuts', 'shortcuts', Keyboard],
    ],
  ],
  [
    'security',
    [
      ['password', 'password', KeyRound],
      ['sessions', 'sessions', MonitorSmartphone],
    ],
  ],
  [
    'billing',
    [
      ['plan', 'plan', Gem],
      ['payment', 'payment', CreditCard],
      ['invoices', 'invoices', Receipt],
    ],
  ],
  // Только для оператора установки (users.is_operator), SettingsPage скрывает группу остальным
  ['operator', [['tenants', 'tenants', Server], ['plans', 'plans', Layers], ['requests', 'requests', Inbox]]],
];

export const DEFAULT_SECTION = 'appearance';
export const SET_SECTIONS = SET_NAV.flatMap(g => g[1]);

export const SHORTCUTS: [string, [nameKey: string, keys: string[]][]][] = [
  [
    'general',
    [
      ['commandMenu', [MOD, 'K']],
      ['search', ['/']],
      ['keyboardShortcuts', ['?']],
      ['toggleSidebar', ['[']],
      ['toggleDarkMode', [MOD, 'Shift', 'L']],
      ['closePanel', ['Esc']],
    ],
  ],
  [
    'create',
    [
      ['newTask', ['N']],
      ['newProject', ['P']],
      ['submitForm', [MOD, '↵']],
      ['sendComment', [MOD, '↵']],
    ],
  ],
  [
    'navigate',
    [
      ['goHome', ['G', 'H']],
      ['goMyTasks', ['G', 'T']],
      ['goProjects', ['G', 'P']],
      ['goInbox', ['G', 'I']],
      ['goCalendar', ['G', 'C']],
      ['goSettings', ['G', 'S']],
    ],
  ],
  [
    'command',
    [
      ['moveSelection', ['↑', '↓']],
      ['runCommand', ['↵']],
      ['searchMode', ['Tab']],
    ],
  ],
];
