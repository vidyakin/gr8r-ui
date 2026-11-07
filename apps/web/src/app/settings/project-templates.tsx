/* Settings → Project templates: список шаблонов проектов, переименование, флаг «отключён», удаление.
   Шаблон создаётся из проекта (меню проекта → «Сохранить как шаблон»), проект из шаблона — в окне «Новый проект». */
import * as React from 'react';
import { Copy } from 'lucide-react';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Field, Input, Skeleton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { useIsAdmin } from '../catalog/data';
import { useProjectTemplates, useProjectTemplatesApi, type ProjectTemplateItem } from './project-templates-data';
import { SettingsHead, SRow } from './parts';

export function ProjectTemplatesSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = useProjectTemplatesApi();
  const list = useProjectTemplates();
  const [editing, setEditing] = React.useState<string | null>(null);
  const [name, setName] = React.useState('');
  const [del, setDel] = React.useState<ProjectTemplateItem | null>(null);

  const summary = (p: ProjectTemplateItem) =>
    [t('projectTemplates.settings.summary', { tasks: p.taskCount, subtasks: p.subtaskCount }), p.durationDays ? t('projectTemplates.settings.duration', { days: p.durationDays }) : '', p.description].filter(Boolean).join(' · ');

  return (
    <>
      <SettingsHead title={title} lead={t('projectTemplates.settings.lead')} />
      {!isAdmin && <Alert tone="info" className="mb-3">{t('projectTemplates.settings.onlyAdmins')}</Alert>}
      <div className="sblock">
        <h2 style={{ margin: '0 0 8px' }}>{title}</h2>
        {list.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : !(list.data ?? []).length ? (
          <EmptyState icon={<Copy size={20} />} title={t('projectTemplates.settings.empty')}>{t('projectTemplates.settings.emptyHint')}</EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {(list.data ?? []).map(p => (
              <div key={p.id} className="srow" style={{ display: 'block' }}>
                <SRow
                  t={
                    <>
                      {p.name} {p.disabled && <Badge>{t('projectTemplates.settings.disabled')}</Badge>}
                    </>
                  }
                  d={p.disabled ? `${summary(p)} · ${t('projectTemplates.settings.disabledHint')}` : summary(p)}
                >
                  {isAdmin && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(editing === p.id ? null : p.id);
                          setName(p.name);
                        }}
                      >
                        {editing === p.id ? t('projectTemplates.settings.cancel') : t('projectTemplates.settings.rename')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          if (await api('PATCH', `/${p.id}`, { disabled: !p.disabled })) toast(p.disabled ? t('projectTemplates.settings.enabledToast') : t('projectTemplates.settings.disabledToast'));
                        }}
                      >
                        {p.disabled ? t('projectTemplates.settings.enable') : t('projectTemplates.settings.disable')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDel(p)}>
                        {t('projectTemplates.settings.delete')}
                      </Button>
                    </>
                  )}
                </SRow>
                {editing === p.id && (
                  <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'flex-end' }}>
                    <Field label={t('projectTemplates.settings.nameLabel')}>{f => <Input {...f} maxLength={200} value={name} onChange={e => setName(e.target.value)} />}</Field>
                    <Button
                      size="sm"
                      disabled={!name.trim()}
                      onClick={async () => {
                        if (await api('PATCH', `/${p.id}`, { name: name.trim() })) {
                          toast(t('projectTemplates.settings.renamed'));
                          setEditing(null);
                        }
                      }}
                    >
                      {t('projectTemplates.settings.save')}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!del}
        onOpenChange={o => !o && setDel(null)}
        title={t('projectTemplates.settings.delete')}
        description={del ? t('projectTemplates.settings.confirmDelete', { name: del.name }) : ''}
        confirmLabel={t('projectTemplates.settings.delete')}
        cancelLabel={t('projectTemplates.settings.cancel')}
        danger
        onConfirm={async () => {
          if (del && (await api('DELETE', `/${del.id}`))) toast(t('projectTemplates.settings.deleted'));
          setDel(null);
        }}
      />
    </>
  );
}
