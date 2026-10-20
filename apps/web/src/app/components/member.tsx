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
import { useWorkspace } from '../data/store';
import { allTasks, me as selectMe } from '../data/selectors';
import type { Member } from '../data/types';
import { useTaskForm } from '../overlays';

/** Роли, которые можно назначить (Owner — только владелец воркспейса) */
export const ASSIGNABLE_ROLES = ['Admin', 'Member', 'Guest'] as const;
export const ROLE_HINT: Record<(typeof ASSIGNABLE_ROLES)[number], string> = {
  Admin: 'Manage members, settings, and all projects',
  Member: 'Create projects and work on tasks',
  Guest: 'Only sees projects they are invited to',
};

export const canManageMembers = (m?: Member) => !!m && ['Owner', 'Admin'].includes(m.role);

/** Действия над участником; confirm — окно подтверждения удаления, его нужно отрисовать рядом */
export function useMemberActions() {
  const { data, dispatch } = useWorkspace();
  const navigate = useNavigate();
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
    toast(`Removed ${m.name}`, { action: { label: 'Undo', onClick: () => dispatch({ type: 'member/restore', member: m, index, tasks, projects }) } });
  };

  const n = removing ? openTasks(removing) : 0;
  const confirm = (
    <ConfirmDialog
      open={!!removing}
      onOpenChange={o => !o && setRemoving(null)}
      danger
      title={`Remove ${removing?.name ?? ''}?`}
      description={
        removing && (
          <>
            {removing.name} will lose access to {data.ws.name} immediately.
            {n > 0 && (
              <>
                {' '}
                Their <b>{`${n} open task${n > 1 ? 's' : ''}`}</b> will become unassigned.
              </>
            )}
          </>
        )
      }
      confirmLabel="Remove member"
      cancelLabel="Cancel"
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
      toast('Email copied');
    },
    resend: (m: Member) => toast(`Invite resent to ${m.email}`),
    setRole: (m: Member, role: Member['role']) => {
      if (role === m.role) return;
      dispatch({ type: 'member/setRole', id: m.id, role });
      toast(`${m.name} is now ${role === 'Admin' ? 'an' : 'a'} ${role}`);
    },
    askRemove: (m: Member) => setRemoving(m),
  };
}

export type MemberActions = ReturnType<typeof useMemberActions>;

const RoleItems = ({ m, actions }: { m: Member; actions: MemberActions }) => (
  <MenuRadioGroup value={m.role} onValueChange={v => actions.setRole(m, v as Member['role'])}>
    {ASSIGNABLE_ROLES.map(r => (
      <MenuRadioItem key={r} value={r} style={{ height: 'auto', padding: '7px 8px', alignItems: 'flex-start' }}>
        <div style={{ whiteSpace: 'normal' }}>
          <div style={{ fontWeight: 500 }}>{r}</div>
          <div className="faint" style={{ fontSize: 11.5 }}>
            {ROLE_HINT[r]}
          </div>
        </div>
      </MenuRadioItem>
    ))}
  </MenuRadioGroup>
);

/** Роль в таблице: админы могут её менять (кроме владельца), остальным — просто метка */
export function RoleCell({ m, actions }: { m: Member; actions: MemberActions }) {
  const { data } = useWorkspace();
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
        <button className="pillbtn bordered" aria-label={`Role: ${m.role}`}>
          {m.role}
          <ChevronDown size={12} />
        </button>
      </MenuTrigger>
      <MenuContent style={{ width: 300 }}>
        <div className="mh">Role for {m.name}</div>
        <RoleItems m={m} actions={actions} />
      </MenuContent>
    </Menu>
  );
}

/** Меню «…» участника (ctx member в оригинале) */
export function MemberMenu({ m, actions, size = 'sm', iconSize = 14, label = 'Member options' }: { m: Member; actions: MemberActions; size?: 'sm' | 'md'; iconSize?: number; label?: string }) {
  const { data } = useWorkspace();
  const canRm = m.role !== 'Owner' && m.id !== data.me;
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton size={size} label={label} tooltip={false}>
          <Ellipsis size={iconSize} />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon={<User size={15} />} onSelect={() => actions.open(m)}>
          View profile
        </MenuItem>
        <MenuItem icon={<Plus size={15} />} onSelect={() => actions.assign(m)}>
          Assign a task
        </MenuItem>
        <MenuItem icon={<Mail size={15} />} onSelect={() => actions.copyEmail(m)}>
          Copy email
        </MenuItem>
        {canRm && (
          <>
            <MenuSub>
              <MenuSubTrigger icon={<Shield size={15} />}>Change role…</MenuSubTrigger>
              <MenuSubContent style={{ width: 300 }}>
                <div className="mh">Role for {m.name}</div>
                <RoleItems m={m} actions={actions} />
              </MenuSubContent>
            </MenuSub>
            {m.status === 'invited' && (
              <MenuItem icon={<Send size={15} />} onSelect={() => actions.resend(m)}>
                Resend invite
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem icon={<UserMinus size={15} />} danger onSelect={() => actions.askRemove(m)}>
              Remove from workspace
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

export function MemberStatus({ status }: { status: Member['status'] }) {
  if (status === 'invited')
    return (
      <Badge tone="amber" dot>
        Invited
      </Badge>
    );
  if (status === 'deactivated') return <Badge tone="gray">Deactivated</Badge>;
  return (
    <Badge tone="green" dot>
      Active
    </Badge>
  );
}
