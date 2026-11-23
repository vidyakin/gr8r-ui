/* Узел графа скрипта продаж для React Flow: тип этапа, заголовок, фрагмент подсказки и счётчик полей. */
import * as React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { ListChecks } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import type { SalesScriptNodeKind } from './ai-chats-data';

export interface ScriptNodeData extends Record<string, unknown> {
  kind: SalesScriptNodeKind;
  title: string;
  promptHint: string;
  collectFields: string[];
}

export type ScriptRFNode = Node<ScriptNodeData, 'script'>;

const KIND_COLOR: Record<SalesScriptNodeKind, string> = {
  start: 'var(--green)',
  stage: 'var(--accent)',
  branch: 'var(--teal)',
  objection: 'var(--amber)',
  action: 'var(--violet)',
  end: 'var(--muted)',
};

const KIND_TONE: Record<SalesScriptNodeKind, Tone> = {
  start: 'green',
  stage: 'accent',
  branch: 'accent',
  objection: 'amber',
  action: 'violet',
  end: 'neutral',
};

export function SalesScriptNodeCard({ data, selected }: NodeProps<ScriptRFNode>) {
  const t = useT();
  const color = KIND_COLOR[data.kind] ?? 'var(--accent)';

  return (
    <div
      className={cn('fn', selected && 'sel')}
      style={{ '--fn-c': color, width: 228 } as React.CSSProperties}
    >
      {data.kind !== 'start' && <Handle type="target" position={Position.Left} />}
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
        <Badge tone={KIND_TONE[data.kind]}>{t(`aiChats.script.kinds.${data.kind}`)}</Badge>
        {data.collectFields.length > 0 && (
          <Badge tone="neutral" title={data.collectFields.join(', ')}>
            <ListChecks size={11} />
            {data.collectFields.length}
          </Badge>
        )}
      </div>
      <div className="trunc" style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>
        {data.title || t(`aiChats.script.kinds.${data.kind}`)}
      </div>
      {data.promptHint && (
        <div
          className="muted"
          style={{
            marginTop: 4,
            fontSize: 11.5,
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {data.promptHint}
        </div>
      )}
      {data.kind === 'branch' || data.kind === 'objection' ? (
        <>
          <Handle type="source" position={Position.Right} id="yes" style={{ top: '34%' }} />
          <Handle type="source" position={Position.Right} id="no" style={{ top: '70%' }} />
          <span
            className="faint"
            style={{ position: 'absolute', right: 10, top: '34%', transform: 'translateY(-50%)', fontSize: 10, pointerEvents: 'none' }}
          >
            {data.kind === 'branch' ? 'Да' : 'Снято'}
          </span>
          <span
            className="faint"
            style={{ position: 'absolute', right: 10, top: '70%', transform: 'translateY(-50%)', fontSize: 10, pointerEvents: 'none' }}
          >
            {data.kind === 'branch' ? 'Нет' : 'Отказ'}
          </span>
        </>
      ) : (
        data.kind !== 'end' && <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}
