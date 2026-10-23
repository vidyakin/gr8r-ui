import { Component, Keyboard, Languages, LogOut, Moon, Settings, Sun, SunMoon, User } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger, toast, usePrefs, type ThemeMode } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { SECTIONS } from '../routes';
import { useSession } from '../data/session';
import { useShortcuts } from '../overlays';
import { LOCALES, isLocale, setLocale, useLocale, useT } from '@/i18n';
import { errorMessage } from '../data/api';

/** Меню аккаунта: профиль, тема, настройки. Триггер передаётся дочерним элементом. */
export function UserMenu({ children, side = 'bottom', align = 'end' }: { children: React.ReactElement; side?: 'top' | 'bottom'; align?: 'start' | 'end' }) {
  const { data } = useWorkspace();
  const { prefs, setPrefs } = usePrefs();
  const navigate = useNavigate();
  const session = useSession();
  const shortcuts = useShortcuts();
  const me = data.members.find(m => m.id === data.me)!;
  const t = useT();
  const locale = useLocale();
  return (
    <Menu>
      <MenuTrigger asChild>{children}</MenuTrigger>
      <MenuContent side={side} align={align} className="min-w-[230px]">
        <div className="px-2 pt-1.5 pb-2">
          <div className="text-sm font-medium">{me.name}</div>
          <div className="text-xs text-text-3">{me.email}</div>
        </div>
        <MenuSeparator />
        <MenuItem icon={<User size={15} />} onSelect={() => navigate(`${SECTIONS.settings.path}/profile`)}>
          {t('nav.profile')}
        </MenuItem>
        <MenuItem icon={<Settings size={15} />} shortcut="G S" onSelect={() => navigate(SECTIONS.settings.path)}>
          {SECTIONS.settings.name}
        </MenuItem>
        <MenuItem icon={<Component size={15} />} onSelect={() => navigate(SECTIONS.system.path)}>
          {SECTIONS.system.name}
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>{t('nav.theme')}</MenuLabel>
        <MenuRadioGroup value={prefs.theme} onValueChange={v => setPrefs({ theme: v as ThemeMode })}>
          <MenuRadioItem value="system" icon={<SunMoon size={15} />}>
            {t('nav.themeSystem')}
          </MenuRadioItem>
          <MenuRadioItem value="light" icon={<Sun size={15} />}>
            {t('nav.themeLight')}
          </MenuRadioItem>
          <MenuRadioItem value="dark" icon={<Moon size={15} />}>
            {t('nav.themeDark')}
          </MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuLabel>{t('nav.language')}</MenuLabel>
        {/* Личный выбор: сразу меняем язык, на сервере сохраняем в users.locale */}
        <MenuRadioGroup
          value={locale}
          onValueChange={v => {
            if (!isLocale(v)) return;
            setLocale(v);
            session.setMyLocale(v).catch(e => toast.error(errorMessage(e)));
          }}
        >
          {LOCALES.map(l => (
            <MenuRadioItem key={l} value={l} icon={<Languages size={15} />}>
              {t(`languages.${l}`)}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem icon={<Keyboard size={15} />} shortcut="?" onSelect={() => shortcuts.open()}>
          {t('nav.shortcuts')}
        </MenuItem>
        <MenuItem icon={<LogOut size={15} />} onSelect={() => void session.signOut().then(() => navigate('/signin'))}>
          {t('nav.signOut')}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
