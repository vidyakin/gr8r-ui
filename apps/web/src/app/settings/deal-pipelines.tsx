/* Settings → Deal pipelines / Lost reasons (задача 1176): воронки и их этапы (категория, цвет, вероятность, норматив дней,
   обязательные поля, порядок), справочник причин проигрыша. Правят admin и owner; читают все. */
import * as React from 'react';
import { ArrowDown, ArrowUp, GitBranch, ListOrdered, Plus, Star, Trash2 } from 'lucide-react';
import { DEAL_REQUIRED_BUILTINS, DEAL_STAGE_CATEGORIES, LEAD_STATUS_COLORS, PIPELINE_TEMPLATES, type DealStageCategory } from '@gr8r/shared';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Field, Input, Select, Skeleton } from '@/components/ui';
import { useT } from '@/i18n';
import { useIsAdmin } from '../catalog/data';
import { usePipelines, usePipelinesApi, type DealPipeline, type DealStageRow } from '../crm/pipelines';
import { useAllEntities } from '../meta/data';
import { SettingsHead, SRow } from './parts';

/** Число из поля ввода: пусто — null (без норматива) */
const num = (s: string): number | null => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Math.max(0, Math.round(Number(s))));

function StageRowEditor({ stage, index, count, isAdmin, onMove, customKeys }: { stage: DealStageRow; index: number; count: number; isAdmin: boolean; onMove: (i: number, d: -1 | 1) => void; customKeys: { key: string; name: string }[] }) {
  const t = useT();
  const api = usePipelinesApi();
  const [name, setName] = React.useState(stage.name);
  const [prob, setProb] = React.useState(String(stage.probability));
  const [sla, setSla] = React.useState(stage.slaDays == null ? '' : String(stage.slaDays));
  const [del, setDel] = React.useState(false);
  const patch = (b: Record<string, unknown>) => api('PATCH', `/deal-stages/${stage.id}`, b);
  const toggleRequired = (key: string) => {
    const has = stage.requiredFields.includes(key);
    void patch({ requiredFields: has ? stage.requiredFields.filter(f => f !== key) : [...stage.requiredFields, key] });
  };
  const requiredOptions = [...DEAL_REQUIRED_BUILTINS.map(k => ({ key: k as string, label: t(`crm.pipelines.required.${k}`) })), ...customKeys.map(c => ({ key: `custom:${c.key}`, label: c.name }))];

  return (
    <div className="srow" style={{ display: 'block' }}>
      <SRow t={<><Badge>{t(`crm.pipelines.category.${stage.category}`)}</Badge> {stage.name}</>} d={t('crm.pipelines.stageSummary', { prob: stage.probability, sla: stage.slaDays ?? '—' })}>
        {isAdmin && (
          <div className="row" style={{ gap: 4 }}>
            <Button size="sm" variant="ghost" aria-label={t('crm.pipelines.up')} disabled={index === 0} onClick={() => onMove(index, -1)}><ArrowUp size={13} /></Button>
            <Button size="sm" variant="ghost" aria-label={t('crm.pipelines.down')} disabled={index === count - 1} onClick={() => onMove(index, 1)}><ArrowDown size={13} /></Button>
            <Button size="sm" variant="ghost" aria-label={t('crm.pipelines.deleteStage')} onClick={() => setDel(true)}><Trash2 size={13} /></Button>
          </div>
        )}
      </SRow>
      {isAdmin && (
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t('crm.pipelines.stageName')}>{p => <Input {...p} maxLength={200} value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name !== stage.name && void patch({ name: name.trim() })} />}</Field>
            <Select value={stage.category} aria-label={t('crm.pipelines.categoryLabel')} onValueChange={v => void patch({ category: v })} options={DEAL_STAGE_CATEGORIES.map(c => ({ value: c, label: t(`crm.pipelines.category.${c}`) }))} />
            <Select value={stage.color} aria-label={t('crm.pipelines.color')} onValueChange={v => void patch({ color: v })} options={LEAD_STATUS_COLORS.map(c => ({ value: c, label: t(`leads.color.${c}`) }))} />
            <Field label={t('crm.pipelines.probability')}>{p => <Input {...p} type="number" min={0} max={100} style={{ width: 90 }} value={prob} onChange={e => setProb(e.target.value)} onBlur={() => { const v = num(prob); if (v !== null && v <= 100 && v !== stage.probability) void patch({ probability: v }); else setProb(String(stage.probability)); }} />}</Field>
            <Field label={t('crm.pipelines.sla')}>{p => <Input {...p} type="number" min={0} style={{ width: 90 }} value={sla} onChange={e => setSla(e.target.value)} onBlur={() => { const v = num(sla); if (v !== stage.slaDays) void patch({ slaDays: v }); }} />}</Field>
          </div>
          <div>
            <span className="label">{t('crm.pipelines.requiredLabel')}</span>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              {requiredOptions.map(o => (
                <label key={o.key} className="row" style={{ gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={stage.requiredFields.includes(o.key)} onChange={() => toggleRequired(o.key)} />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={t('crm.pipelines.deleteStage')}
        description={t('crm.pipelines.deleteStageDesc', { name: stage.name })}
        confirmLabel={t('crm.pipelines.delete')}
        cancelLabel={t('crm.common.cancel')}
        danger
        onConfirm={async () => {
          await api('DELETE', `/deal-stages/${stage.id}`);
          setDel(false);
        }}
      />
    </div>
  );
}

function PipelineBlock({ pipeline, stages, isAdmin, customKeys }: { pipeline: DealPipeline; stages: DealStageRow[]; isAdmin: boolean; customKeys: { key: string; name: string }[] }) {
  const t = useT();
  const api = usePipelinesApi();
  const [name, setName] = React.useState(pipeline.name);
  const [del, setDel] = React.useState(false);
  const [sName, setSName] = React.useState('');
  const [sCat, setSCat] = React.useState<DealStageCategory>('in_progress');

  const move = async (i: number, d: -1 | 1) => {
    const ids = stages.map(s => s.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await api('POST', '/deal-stages/reorder', { pipelineId: pipeline.id, ids });
  };

  return (
    <div className="sblock">
      <SRow t={<>{pipeline.name} {pipeline.isDefault && <Badge tone="accent">{t('crm.pipelines.default')}</Badge>}</>} d={t('crm.pipelines.stagesCount', { count: stages.length })}>
        {isAdmin && (
          <div className="row" style={{ gap: 4 }}>
            {!pipeline.isDefault && (
              <Button size="sm" variant="ghost" onClick={() => void api('PATCH', `/deal-pipelines/${pipeline.id}`, { isDefault: true })}>
                <Star size={13} />
                {t('crm.pipelines.makeDefault')}
              </Button>
            )}
            {!pipeline.isDefault && (
              <Button size="sm" variant="ghost" aria-label={t('crm.pipelines.deletePipeline')} onClick={() => setDel(true)}>
                <Trash2 size={13} />
              </Button>
            )}
          </div>
        )}
      </SRow>
      {isAdmin && (
        <Field label={t('crm.pipelines.pipelineName')}>{p => <Input {...p} maxLength={200} value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name !== pipeline.name && void api('PATCH', `/deal-pipelines/${pipeline.id}`, { name: name.trim() })} />}</Field>
      )}
      <div className="stack" style={{ gap: 8, marginTop: 10 }}>
        {stages.map((s, i) => (
          <StageRowEditor key={s.id} stage={s} index={i} count={stages.length} isAdmin={isAdmin} onMove={(a, b) => void move(a, b)} customKeys={customKeys} />
        ))}
      </div>
      {isAdmin && (
        <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label={t('crm.pipelines.stageName')}>{p => <Input {...p} maxLength={200} value={sName} onChange={e => setSName(e.target.value)} />}</Field>
          <Select value={sCat} aria-label={t('crm.pipelines.categoryLabel')} onValueChange={v => setSCat(v as DealStageCategory)} options={DEAL_STAGE_CATEGORIES.map(c => ({ value: c, label: t(`crm.pipelines.category.${c}`) }))} />
          <Button
            size="sm"
            disabled={!sName.trim()}
            onClick={async () => {
              if (await api('POST', '/deal-stages', { pipelineId: pipeline.id, name: sName.trim(), category: sCat })) setSName('');
            }}
          >
            <Plus size={13} />
            {t('crm.pipelines.addStage')}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={t('crm.pipelines.deletePipeline')}
        description={t('crm.pipelines.deletePipelineDesc', { name: pipeline.name })}
        confirmLabel={t('crm.pipelines.delete')}
        cancelLabel={t('crm.common.cancel')}
        danger
        onConfirm={async () => {
          await api('DELETE', `/deal-pipelines/${pipeline.id}`);
          setDel(false);
        }}
      />
    </div>
  );
}

export function DealPipelinesSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = usePipelinesApi();
  const q = usePipelines();
  const entities = useAllEntities();
  const [name, setName] = React.useState('');
  const [template, setTemplate] = React.useState<string>(PIPELINE_TEMPLATES[0]!.key);
  // поля конструктора сущности «Сделки» — их можно сделать обязательными для этапа
  const customKeys = React.useMemo(() => {
    const dealEntity = (entities.data ?? []).find(e => e.key === 'deal');
    return (dealEntity?.fields ?? []).filter(f => !f.archivedAt && !f.isSystem).map(f => ({ key: f.key, name: f.name }));
  }, [entities.data]);
  const data = q.data;

  return (
    <>
      <SettingsHead title={title} lead={t('crm.pipelines.lead')} />
      {!isAdmin && <Alert tone="info" className="mb-3">{t('crm.pipelines.onlyAdmins')}</Alert>}
      {!data ? (
        <Skeleton w="100%" h={60} />
      ) : !data.pipelines.length ? (
        <EmptyState icon={<GitBranch size={20} />} title={t('crm.pipelines.empty')} />
      ) : (
        data.pipelines.map(p => <PipelineBlock key={p.id} pipeline={p} stages={data.stages.filter(s => s.pipelineId === p.id)} isAdmin={isAdmin} customKeys={customKeys} />)
      )}
      {isAdmin && (
        <div className="sblock">
          <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label={t('crm.pipelines.pipelineName')}>{p => <Input {...p} maxLength={200} value={name} onChange={e => setName(e.target.value)} />}</Field>
            <Select value={template} aria-label={t('crm.pipelines.template')} onValueChange={setTemplate} options={PIPELINE_TEMPLATES.map(x => ({ value: x.key, label: t(`crm.pipelines.templates.${x.key}` as never) }))} />
            <Button
              size="sm"
              disabled={!name.trim()}
              onClick={async () => {
                if (await api('POST', '/deal-pipelines', { name: name.trim(), template })) setName('');
              }}
            >
              <Plus size={13} />
              {t('crm.pipelines.addPipeline')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

export function LostReasonsSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = usePipelinesApi();
  const q = usePipelines();
  const [name, setName] = React.useState('');
  const [del, setDel] = React.useState<{ id: string; name: string } | null>(null);
  const list = q.data?.reasons ?? [];

  const move = async (i: number, d: -1 | 1) => {
    const ids = list.map(r => r.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await api('POST', '/deal-lost-reasons/reorder', { ids });
  };

  return (
    <>
      <SettingsHead title={title} lead={t('crm.pipelines.reasonsLead')} />
      {!isAdmin && <Alert tone="info" className="mb-3">{t('crm.pipelines.onlyAdmins')}</Alert>}
      <div className="sblock">
        {q.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : !list.length ? (
          <EmptyState icon={<ListOrdered size={20} />} title={t('crm.pipelines.reasonsEmpty')} />
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {list.map((r, i) => (
              <div key={r.id} className="srow" style={{ display: 'block' }}>
                <SRow t={r.name}>
                  {isAdmin && (
                    <div className="row" style={{ gap: 4 }}>
                      <Button size="sm" variant="ghost" aria-label={t('crm.pipelines.up')} disabled={i === 0} onClick={() => void move(i, -1)}><ArrowUp size={13} /></Button>
                      <Button size="sm" variant="ghost" aria-label={t('crm.pipelines.down')} disabled={i === list.length - 1} onClick={() => void move(i, 1)}><ArrowDown size={13} /></Button>
                      <Button size="sm" variant="ghost" aria-label={t('crm.pipelines.delete')} onClick={() => setDel(r)}><Trash2 size={13} /></Button>
                    </div>
                  )}
                </SRow>
              </div>
            ))}
          </div>
        )}
        {isAdmin && (
          <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'flex-end' }}>
            <Field label={t('crm.pipelines.reasonName')}>{p => <Input {...p} maxLength={200} value={name} onChange={e => setName(e.target.value)} />}</Field>
            <Button
              size="sm"
              disabled={!name.trim()}
              onClick={async () => {
                if (await api('POST', '/deal-lost-reasons', { name: name.trim() })) setName('');
              }}
            >
              <Plus size={13} />
              {t('crm.pipelines.addReason')}
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!del}
        onOpenChange={o => !o && setDel(null)}
        title={t('crm.pipelines.delete')}
        description={del ? t('crm.pipelines.deleteReasonDesc', { name: del.name }) : ''}
        confirmLabel={t('crm.pipelines.delete')}
        cancelLabel={t('crm.common.cancel')}
        danger
        onConfirm={async () => {
          if (del) await api('DELETE', `/deal-lost-reasons/${del.id}`);
          setDel(null);
        }}
      />
    </>
  );
}
