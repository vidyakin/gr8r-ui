import { Component, Keyboard, LogOut, Moon, Settings, Sun, SunMoon, User } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger, usePrefs, type ThemeMode } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { SECTIONS } from '../routes';
import { useSession } from '../data/session';
import { useShortcuts } from '../overlays';

/** Меню аккаунта: профиль, тема, настройки. Триггер передаётся дочерним элементом. */
export function UserMenu({ children, side = 'bottom', align = 'end' }: { children: React.ReactElement; side?: 'top' | 'bottom'; align?: 'start' | 'end' }) {
  const { data } = useWorkspace();
  const { prefs, setPrefs } = usePrefs();
  const navigate = useNavigate();
  const session = useSession();
  const shortcuts = useShortcuts();
  const me = data.members.find(m => m.id === data.me)!;
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
          Profile
        </MenuItem>
        <MenuItem icon={<Settings size={15} />} shortcut="G S" onSelect={() => navigate(SECTIONS.settings.path)}>
          Settings
        </MenuItem>
        <MenuItem icon={<Component size={15} />} onSelect={() => navigate(SECTIONS.system.path)}>
          Design system
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Theme</MenuLabel>
        <MenuRadioGroup value={prefs.theme} onValueChange={v => setPrefs({ theme: v as ThemeMode })}>
          <MenuRadioItem value="system" icon={<SunMoon size={15} />}>
            System
          </MenuRadioItem>
          <MenuRadioItem value="light" icon={<Sun size={15} />}>
            Light
          </MenuRadioItem>
          <MenuRadioItem value="dark" icon={<Moon size={15} />}>
            Dark
          </MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem icon={<Keyboard size={15} />} shortcut="?" onSelect={() => shortcuts.open()}>
          Keyboard shortcuts
        </MenuItem>
        <MenuItem icon={<LogOut size={15} />} onSelect={() => void session.signOut().then(() => navigate('/signin'))}>
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
