/* Карточка узла на холсте React Flow: иконка и название, краткие параметры, вход слева, выходы справа (у условия — true / false). */
import * as React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { getNodeDef, nodeOutputs } from '@gr8r/shared';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { CATEGORY_COLOR, NodeIcon, paramSummary } from './node-meta';
import { nodeLabel } from './node-i18n';

export interface FlowNodeData extends Record<string, unknown> {
  nodeType: string;
  params: Record<string, unknown>;
}
export type RFNode = Node<FlowNodeData, 'gr8r'>;

/** Замечания проверки графа по id узла. Лежат в контексте, а не в данных узла: так проверка не зависит от состояния React Flow */
export const IssuesContext = React.createContext<Map<string, string[]>>(new Map());

export function FlowNodeView({ id, data, selected }: NodeProps<RFNode>) {
  const t = useT();
  const issues = React.useContext(IssuesContext).get(id) ?? [];
  const def = getNodeDef(data.nodeType);
  if (!def) {
    return (
      <div className="fn bad">
        <Handle type="target" position={Position.Left} id="in" />
        <div className="fn-h">{t('automations.editor.unknownNode', { type: data.nodeType })}</div>
      </div>
    );
  }
  const outputs = nodeOutputs(def, data.params);
  const multi = outputs.length > 1;
  const summary = paramSummary(def, data.params);
  return (
    <div className={cn('fn', selected && 'sel', issues.length > 0 && 'bad')} style={{ '--fn-c': CATEGORY_COLOR[def.category] } as React.CSSProperties} title={issues.join('\n') || undefined} data-node-type={def.type}>
      {def.category !== 'trigger' && <Handle type="target" position={Position.Left} id="in" />}
      <div className="fn-h">
        <span className="fn-ico">
          <NodeIcon name={def.icon} size={13} />
        </span>
        <span className="fn-t trunc">{nodeLabel(def)}</span>
      </div>
      {summary.length > 0 && (
        <div className="fn-s">
          {summary.map(s => (
            <div key={s} className="trunc">
              {s}
            </div>
          ))}
        </div>
      )}
      {multi ? (
        <div className="fn-outs">
          {outputs.map(o => (
            <div key={o.id} className="fn-out">
              <span className="trunc">{o.label}</span>
              <Handle type="source" position={Position.Right} id={o.id} />
            </div>
          ))}
        </div>
      ) : (
        <Handle type="source" position={Position.Right} id={outputs[0]?.id ?? 'out'} />
      )}
    </div>
  );
}
