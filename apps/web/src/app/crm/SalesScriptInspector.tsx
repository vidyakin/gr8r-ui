/* Правая панель инспектора для выбранного узла или связи в редакторе скрипта продаж. */
import * as React from 'react';
import type { Edge } from '@xyflow/react';
import { MousePointerClick, Trash2 } from 'lucide-react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { useT } from '@/i18n';
import type { SalesScriptNodeKind } from './ai-chats-data';
import type { ScriptNodeData, ScriptRFNode } from './SalesScriptNodeCard';

const KINDS: SalesScriptNodeKind[] = ['start', 'stage', 'branch', 'objection', 'action', 'end'];

interface SalesScriptInspectorProps {
  node: ScriptRFNode | null;
  edge: Edge | null;
  onUpdateNode: (id: string, patch: Partial<ScriptNodeData>) => void;
  onDeleteNode: (id: string) => void;
  onUpdateEdge: (id: string, condition: string) => void;
  onDeleteEdge: (id: string) => void;
}

export function SalesScriptInspector({
  node,
  edge,
  onUpdateNode,
  onDeleteNode,
  onUpdateEdge,
  onDeleteEdge,
}: SalesScriptInspectorProps) {
  const t = useT();
  const [fieldsText, setFieldsText] = React.useState('');

  React.useEffect(() => {
    setFieldsText(node ? node.data.collectFields.join(', ') : '');
  }, [node?.id]);

  const kindOptions = React.useMemo(
    () => KINDS.map(k => ({ value: k, label: t(`aiChats.script.kinds.${k}`) })),
    [t],
  );

  return (
    <aside
      className="stack"
      style={{
        width: 300,
        flexShrink: 0,
        padding: 16,
        gap: 14,
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
        background: 'var(--surface)',
      }}
    >
      {node ? (
        <>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ fontSize: 13.5 }}>{t('aiChats.script.inspectorNode')}</strong>
            <Button size="sm" variant="danger-ghost" onClick={() => onDeleteNode(node.id)}>
              <Trash2 size={13} />
              {t('aiChats.script.deleteNode')}
            </Button>
          </div>
          <Field label={t('aiChats.script.title')}>
            {({ id }) => (
              <Input
                id={id}
                size="sm"
                value={node.data.title}
                onChange={e => onUpdateNode(node.id, { title: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('aiChats.script.kind')}>
            {({ id }) => (
              <Select
                id={id}
                size="sm"
                value={node.data.kind}
                options={kindOptions}
                onValueChange={v => onUpdateNode(node.id, { kind: v as SalesScriptNodeKind })}
              />
            )}
          </Field>
          <p
            className="muted"
            style={{
              margin: 0,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-2)',
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            {t(`aiChats.script.kindHints.${node.data.kind}`)}
          </p>
          <Field label={t('aiChats.script.promptHint')}>
            {({ id }) => (
              <Textarea
                id={id}
                rows={5}
                value={node.data.promptHint}
                placeholder={t('aiChats.script.promptHintPh')}
                onChange={e => onUpdateNode(node.id, { promptHint: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('aiChats.script.collectFields')}>
            {({ id }) => (
              <Input
                id={id}
                size="sm"
                value={fieldsText}
                placeholder={t('aiChats.script.collectFieldsPh')}
                onChange={e => {
                  const raw = e.target.value;
                  setFieldsText(raw);
                  onUpdateNode(node.id, {
                    collectFields: raw.split(',').map(s => s.trim()).filter(Boolean),
                  });
                }}
              />
            )}
          </Field>
        </>
      ) : edge ? (
        <>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ fontSize: 13.5 }}>{t('aiChats.script.inspectorEdge')}</strong>
            <Button size="sm" variant="danger-ghost" onClick={() => onDeleteEdge(edge.id)}>
              <Trash2 size={13} />
              {t('aiChats.script.deleteEdge')}
            </Button>
          </div>
          <Field label={t('aiChats.script.condition')}>
            {({ id }) => (
              <Input
                id={id}
                size="sm"
                value={typeof edge.label === 'string' ? edge.label : ''}
                placeholder={t('aiChats.script.conditionPh')}
                onChange={e => onUpdateEdge(edge.id, e.target.value)}
              />
            )}
          </Field>
        </>
      ) : (
        <div className="stack muted" style={{ gap: 8, paddingTop: 24, alignItems: 'center', textAlign: 'center' }}>
          <MousePointerClick size={20} style={{ opacity: 0.55 }} />
          <p style={{ fontSize: 12.5, lineHeight: 1.45, margin: 0 }}>{t('aiChats.script.selectHint')}</p>
        </div>
      )}
    </aside>
  );
}
