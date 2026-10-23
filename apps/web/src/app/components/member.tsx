/* Участник: действия (роль, удаление), меню «…», кнопка выбора роли и бейдж статуса —
   общие для списка на /members и профиля /members/:id. Порт A.removeMember/ctx member/popover role из оригинала. */
import * as React from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Crown, Ellipsis, Mail, Plus, Send, Shield, User, UserMinus, ChevronDown } from 'lucide-react';
import {
  Badge,
  ConfirmDialog,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  toast,
} from '@/components/ui';
import { useT } from '@/i18n';
import { useWorkspace } from '../data/store';
import { allTasks, me as selectMe } from '../data/selectors';
import type { Member } from '../data/types';
import { useTaskForm } from '../overlays';

/** Роли, которые можно назначить (Owner — только владелец воркспейса) */
export const ASSIGNABLE_ROLES = ['Admin', 'Member', 'Guest'] as const;
export const ROLE_KEYS = ['admin', 'member', 'guest'] as const;
export const getRoleHints = (tt: ReturnType<typeof useT>): Record<(typeof ASSIGNABLE_ROLES)[number], string> => ({
  Admin: tt('views.member.roleHint.admin'),
  Member: tt('views.member.roleHint.member'),
  Guest: tt('views.member.roleHint.guest'),
});

export const canManageMembers = (m?: Member) => !!m && ['Owner', 'Admin'].includes(m.role);

/** Действия над участником; confirm — окно подтверждения удаления, его нужно отрисовать рядом */
export function useMemberActions() {
  const { data, dispatch } = useWorkspace();
  const navigate = useNavigate();
  const tt = useT();
  const { pathname } = useLocation();
  const taskForm = useTaskForm();
  const [removing, setRemoving] = React.useState<Member | null>(null);

  const openTasks = (m: Member) => allTasks(data).filter(t => t.assignee === m.id && t.status !== 'done').length;

  const remove = (m: Member) => {
    // Снимок нужен для «Undo»: возвращает участника, его задачи и членство в проектах
    const index = data.members.findIndex(x => x.id === m.id);
    const tasks = data.tasks.filter(t => t.assignee === m.id).map(t => t.id);
    const projects = data.projects.filter(p => p.members.includes(m.id)).map(p => p.id);
    dispatch({ type: 'member/remove', id: m.id });
    toast(tt('views.member.removed', { name: m.name }), { action: { label: tt('common.undo'), onClick: () => dispatch({ type: 'member/restore', member: m, index, tasks, projects }) } });
  };

  const n = removing ? openTasks(removing) : 0;
  const confirm = (
    <ConfirmDialog
      open={!!removing}
      onOpenChange={o => !o && setRemoving(null)}
      danger
      title={tt('views.member.removeTitle', { name: removing?.name ?? '' })}
      description={
        removing && (
          <>
            {tt('views.member.removeText', { name: removing.name, ws: data.ws.name })}
            {n > 0 && (
              <>
                {' '}
                {tt('views.member.openTasksAffected', { count: n })}
              </>
            )}
          </>
        )
      }
      confirmLabel={tt('views.member.remove')}
      cancelLabel={tt('common.cancel')}
      onConfirm={() => {
        if (!removing) return;
        remove(removing);
        // Удаляли со страницы профиля — возвращаемся к списку
        if (pathname === `/members/${removing.id}`) navigate('/members');
      }}
    />
  );

  return {
    confirm,
    open: (m: Member) => navigate(`/members/${m.id}`),
    assign: (m: Member) => taskForm.open({ assignee: m.id }),
    copyEmail: (m: Member) => {
      navigator.clipboard?.writeText(m.email).catch(() => {});
      toast(tt('views.member.emailCopied'));
    },
    resend: (m: Member) => toast(tt('views.member.inviteResent', { email: m.email })),
    setRole: (m: Member, role: Member['role']) => {
      if (role === m.role) return;
      dispatch({ type: 'member/setRole', id: m.id, role });
      const article = role === 'Admin' ? 'an' : 'a';
      toast(tt('views.member.roleChanged', { name: m.name, article, role }));
    },
    askRemove: (m: Member) => setRemoving(m),
  };
}

export type MemberActions = ReturnType<typeof useMemberActions>;

const RoleItems = ({ m, actions }: { m: Member; actions: MemberActions }) => {
  const tt = useT();
  const HINTS = getRoleHints(tt);
  return (
    <MenuRadioGroup value={m.role} onValueChange={v => actions.setRole(m, v as Member['role'])}>
      {ASSIGNABLE_ROLES.map(r => (
        <MenuRadioItem key={r} value={r} style={{ height: 'auto', padding: '7px 8px', alignItems: 'flex-start' }}>
          <div style={{ whiteSpace: 'normal' }}>
            <div style={{ fontWeight: 500 }}>{r}</div>
            <div className="faint" style={{ fontSize: 11.5 }}>
              {HINTS[r]}
            </div>
          </div>
        </MenuRadioItem>
      ))}
    </MenuRadioGroup>
  );
};

/** Роль в таблице: админы могут её менять (кроме владельца), остальным — просто метка */
export function RoleCell({ m, actions }: { m: Member; actions: MemberActions }) {
  const { data } = useWorkspace();
  const tt = useT();
  if (!canManageMembers(selectMe(data)) || m.role === 'Owner')
    return (
      <span className="pillbtn">
        {m.role === 'Owner' && <Crown size={13} />}
        {m.role}
      </span>
    );
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="pillbtn bordered" aria-label={tt('views.member.roleFor', { role: m.role })}>
          {m.role}
          <ChevronDown size={12} />
        </button>
      </MenuTrigger>
      <MenuContent style={{ width: 300 }}>
        <div className="mh">{tt('views.member.roleFor', { name: m.name })}</div>
        <RoleItems m={m} actions={actions} />
      </MenuContent>
    </Menu>
  );
}

/** Меню «…» участника (ctx member в оригинале) */
export function MemberMenu({ m, actions, size = 'sm', iconSize = 14, label }: { m: Member; actions: MemberActions; size?: 'sm' | 'md'; iconSize?: number; label?: string }) {
  const { data } = useWorkspace();
  const tt = useT();
  const canRm = m.role !== 'Owner' && m.id !== data.me;
  const lbl = label ?? tt('views.member.options');
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton size={size} label={lbl} tooltip={false}>
          <Ellipsis size={iconSize} />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon={<User size={15} />} onSelect={() => actions.open(m)}>
          {tt('views.member.viewProfile')}
        </MenuItem>
        <MenuItem icon={<Plus size={15} />} onSelect={() => actions.assign(m)}>
          {tt('views.member.assignTask')}
        </MenuItem>
        <MenuItem icon={<Mail size={15} />} onSelect={() => actions.copyEmail(m)}>
          {tt('views.member.copyEmail')}
        </MenuItem>
        {canRm && (
          <>
            <MenuSub>
              <MenuSubTrigger icon={<Shield size={15} />}>{tt('views.member.changeRole')}</MenuSubTrigger>
              <MenuSubContent style={{ width: 300 }}>
                <div className="mh">{tt('views.member.roleFor', { name: m.name })}</div>
                <RoleItems m={m} actions={actions} />
              </MenuSubContent>
            </MenuSub>
            {m.status === 'invited' && (
              <MenuItem icon={<Send size={15} />} onSelect={() => actions.resend(m)}>
                {tt('views.member.resendInvite')}
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem icon={<UserMinus size={15} />} danger onSelect={() => actions.askRemove(m)}>
              {tt('views.member.removeFromWorkspace')}
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

export function MemberStatus({ status }: { status: Member['status'] }) {
  const tt = useT();
  if (status === 'invited')
    return (
      <Badge tone="amber" dot>
        {tt('views.member.status.invited')}
      </Badge>
    );
  if (status === 'deactivated') return <Badge tone="gray">{tt('views.member.status.deactivated')}</Badge>;
  return (
    <Badge tone="green" dot>
      {tt('views.member.status.active')}
    </Badge>
  );
}
