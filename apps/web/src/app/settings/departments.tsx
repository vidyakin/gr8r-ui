/* Settings → Departments: обёртка экрана подразделений с данными (TanStack Query, участники воркспейса). Само представление —
   app/departments/DepartmentsView.tsx. Справочник читают все, правят admin и owner. */
import * as React from 'react';
import { useT } from '@/i18n';
import { useIsAdmin } from '../catalog/data';
import { useWorkspace } from '../data/store';
import { useDepartments, useDepartmentsApi } from '../departments/data';
import { DepartmentsView } from '../departments/DepartmentsView';
import { SettingsHead } from './parts';

export function DepartmentsSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = useDepartmentsApi();
  const departments = useDepartments();
  const { data: ws } = useWorkspace();
  const members = React.useMemo(() => ws.members.filter(m => m.status === 'active').map(m => ({ id: m.id, name: m.name })), [ws.members]);
  return (
    <>
      <SettingsHead title={title} lead={t('departments.settings.lead')} />
      <DepartmentsView
        title={title}
        departments={departments.data ?? []}
        members={members}
        isAdmin={isAdmin}
        pending={departments.isPending}
        onSave={async (id, body) => !!(await api(id ? 'PATCH' : 'POST', id ? `/departments/${id}` : '/departments', body))}
        onDelete={async id => !!(await api('DELETE', `/departments/${id}`))}
        onSetMember={async (memberId, departmentId) => !!(await api('PUT', `/departments/by-member/${memberId}`, { departmentId }))}
      />
    </>
  );
}
