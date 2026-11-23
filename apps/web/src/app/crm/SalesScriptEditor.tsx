/* Визуальный редактор скрипта продаж для ИИ-чата на базе React Flow + панель инспектора справа. */
import * as React from 'react';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Check, Plus, Save, Sparkles } from 'lucide-react';
import { Button, Choice, Skeleton, Switch, toast } from '@/components/ui';
import { useT } from '@/i18n';
import {
  useAiChatSettings,
  useAiChatsApi,
  type SalesScriptGraph,
  type SalesScriptNodeKind,
} from './ai-chats-data';
import { DEFAULT_SALES_SCRIPT } from './sales-script-defaults';
import { SalesScriptInspector } from './SalesScriptInspector';
import { SalesScriptNodeCard, type ScriptNodeData, type ScriptRFNode } from './SalesScriptNodeCard';

const NODE_TYPES = { script: SalesScriptNodeCard };
const ADD_KINDS: SalesScriptNodeKind[] = ['stage', 'branch', 'objection', 'action', 'end'];

const toRfNodes = (g: SalesScriptGraph): ScriptRFNode[] =>
  g.nodes.map(n => ({
    id: n.id,
    type: 'script',
    position: { x: n.x, y: n.y },
    data: {
      kind: n.kind,
      title: n.title,
      promptHint: n.promptHint,
      collectFields: n.collectFields ?? [],
    },
  }));

const toRfEdges = (g: SalesScriptGraph): Edge[] =>
  g.edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.condition,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  }));

const toGraph = (enabled: boolean, nodes: ScriptRFNode[], edges: Edge[]): SalesScriptGraph => ({
  enabled,
  nodes: nodes.map(n => ({
    id: n.id,
    kind: n.data.kind,
    title: n.data.title,
    promptHint: n.data.promptHint,
    collectFields: n.data.collectFields,
    x: Math.round(n.position.x),
    y: Math.round(n.position.y),
  })),
  edges: edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    condition: typeof e.label === 'string' ? e.label : '',
  })),
});

export function SalesScriptEditor() {
  const t = useT();
  const settings = useAiChatSettings();
  const api = useAiChatsApi();

  const [enabled, setEnabled] = React.useState(false);
  const [nodes, setNodes] = React.useState<ScriptRFNode[]>([]);
  const [edges, setEdges] = React.useState<Edge[]>([]);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [rf, setRf] = React.useState<ReactFlowInstance<ScriptRFNode, Edge> | null>(null);
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const [pendingConn, setPendingConn] = React.useState<{
    sourceId: string;
    sourceHandle?: string | null;
    menuX: number;
    menuY: number;
    flowPos: { x: number; y: number };
  } | null>(null);

  React.useEffect(() => {
    if (!pendingConn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingConn(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingConn]);

  React.useEffect(() => {
    if (!settings.data || dirty) return;
    const script = settings.data.script;
    if (script) {
      setEnabled(script.enabled);
      setNodes(toRfNodes(script));
      setEdges(toRfEdges(script));
    } else {
      setEnabled(false);
      setNodes([]);
      setEdges([]);
    }
  }, [settings.data, dirty]);

  const markDirty = () => {
    setDirty(true);
    setSaved(false);
  };

  const onNodesChange = React.useCallback((changes: NodeChange<ScriptRFNode>[]) => {
    if (changes.some(c => c.type !== 'select' && c.type !== 'dimensions')) markDirty();
    setNodes(prev => applyNodeChanges(changes, prev));
  }, []);

  const onEdgesChange = React.useCallback((changes: EdgeChange[]) => {
    if (changes.some(c => c.type !== 'select')) markDirty();
    setEdges(prev => applyEdgeChanges(changes, prev));
  }, []);

  const onConnect = React.useCallback((conn: Connection) => {
    if (!conn.source || !conn.target) return;
    markDirty();
    const id = `e-${conn.source}-${conn.target}-${Math.random().toString(36).slice(2, 6)}`;
    setEdges(prev =>
      addEdge(
        { ...conn, id, label: '', markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } },
        prev,
      ),
    );
  }, []);

  const onConnectEnd = React.useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode || !rf || !canvasRef.current) return;
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      if (!point) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const menuX = Math.max(8, Math.min(rect.width - 190, point.clientX - rect.left));
      const menuY = Math.max(8, Math.min(rect.height - 170, point.clientY - rect.top));
      const flowPos = rf.screenToFlowPosition({ x: point.clientX, y: point.clientY });
      setPendingConn({ sourceId: state.fromNode.id, sourceHandle: state.fromHandle?.id ?? null, menuX, menuY, flowPos });
    },
    [rf],
  );

  const createConnectedNode = (kind: SalesScriptNodeKind) => {
    if (!pendingConn) return;
    markDirty();
    const id = `n-${Math.random().toString(36).slice(2, 7)}`;
    const next: ScriptRFNode = {
      id,
      type: 'script',
      position: { x: Math.round(pendingConn.flowPos.x), y: Math.round(pendingConn.flowPos.y - 36) },
      selected: true,
      data: { kind, title: t(`aiChats.script.kinds.${kind}`), promptHint: '', collectFields: [] },
    };
    const edgeId = `e-${pendingConn.sourceId}-${id}-${Math.random().toString(36).slice(2, 6)}`;
    const defaultLabel =
      pendingConn.sourceHandle === 'yes' ? 'Да' : pendingConn.sourceHandle === 'no' ? 'Нет' : '';
    setNodes(prev => [...prev.map(n => ({ ...n, selected: false })), next]);
    setEdges(prev => [
      ...prev.map(e => ({ ...e, selected: false })),
      {
        id: edgeId,
        source: pendingConn.sourceId,
        sourceHandle: pendingConn.sourceHandle ?? undefined,
        target: id,
        label: defaultLabel,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      },
    ]);
    setPendingConn(null);
  };

  const addNode = (kind: SalesScriptNodeKind) => {
    markDirty();
    const id = `n-${Math.random().toString(36).slice(2, 7)}`;
    const offset = (nodes.length % 5) * 32;
    const next: ScriptRFNode = {
      id,
      type: 'script',
      position: { x: 120 + offset, y: 120 + offset },
      selected: true,
      data: { kind, title: t(`aiChats.script.kinds.${kind}`), promptHint: '', collectFields: [] },
    };
    setNodes(prev => [...prev.map(n => ({ ...n, selected: false })), next]);
    setEdges(prev => prev.map(e => ({ ...e, selected: false })));
  };

  const loadTemplate = () => {
    markDirty();
    setEnabled(DEFAULT_SALES_SCRIPT.enabled);
    setNodes(toRfNodes(DEFAULT_SALES_SCRIPT));
    setEdges(toRfEdges(DEFAULT_SALES_SCRIPT));
    setPendingConn(null);
    requestAnimationFrame(() => rf?.fitView({ padding: 0.28, maxZoom: 0.78, duration: 220 }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    const res = await api.saveSettings({ script: toGraph(enabled, nodes, edges) });
    setSaving(false);
    if (res) {
      setDirty(false);
      setSaved(true);
      toast.success(t('aiChats.script.saved'));
    }
  };

  const selectedNode = React.useMemo(() => nodes.find(n => n.selected) ?? null, [nodes]);
  const selectedEdge = React.useMemo(() => (selectedNode ? null : edges.find(e => e.selected) ?? null), [edges, selectedNode]);

  const updateNode = (id: string, patch: Partial<ScriptNodeData>) => {
    markDirty();
    setNodes(prev => prev.map(n => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  };

  const deleteNode = (id: string) => {
    markDirty();
    setNodes(prev => prev.filter(n => n.id !== id));
    setEdges(prev => prev.filter(e => e.source !== id && e.target !== id));
  };

  const updateEdge = (id: string, condition: string) => {
    markDirty();
    setEdges(prev => prev.map(e => (e.id === id ? { ...e, label: condition } : e)));
  };

  const deleteEdge = (id: string) => {
    markDirty();
    setEdges(prev => prev.filter(e => e.id !== id));
  };

  if (settings.isPending) {
    return (
      <div className="stack" style={{ gap: 12, padding: '0 var(--page-pad, 24px)' }}>
        <Skeleton h={40} w="100%" />
        <Skeleton h={520} w="100%" />
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 12, padding: '0 var(--page-pad, 24px) 24px' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Choice style={{ marginRight: 8 }}>
            <Switch
              checked={enabled}
              onChange={e => {
                setEnabled(e.target.checked);
                markDirty();
              }}
            />
            <span>{t('aiChats.script.enabled')}</span>
          </Choice>
          {ADD_KINDS.map(kind => (
            <Button key={kind} size="sm" variant="ghost" onClick={() => addNode(kind)}>
              <Plus size={13} />
              {t(`aiChats.script.kinds.${kind}`)}
            </Button>
          ))}
        </div>

        <div className="row" style={{ gap: 8 }}>
          {saved && (
            <span className="row muted" style={{ gap: 4, fontSize: 12.5 }}>
              <Check size={13} />
              {t('aiChats.script.saved')}
            </span>
          )}
          <Button size="sm" variant="ghost" onClick={loadTemplate}>
            <Sparkles size={13} />
            {t('aiChats.script.loadTemplate')}
          </Button>
          <Button size="sm" variant="primary" loading={saving} onClick={() => void handleSave()}>
            <Save size={13} />
            {saving ? t('aiChats.script.saving') : t('aiChats.script.save')}
          </Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
        <div
          ref={canvasRef}
          className="ae-canvas"
          style={{
            position: 'relative',
            flex: 1,
            height: 'calc(100vh - 280px)',
            minHeight: 460,
            border: '1px solid var(--border)',
            borderRadius: 'var(--r)',
            background: 'var(--bg)',
            overflow: 'hidden',
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onInit={setRf}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onPaneClick={() => setPendingConn(null)}
            fitView
            fitViewOptions={{ padding: 0.28, maxZoom: 0.78 }}
            minZoom={0.25}
            maxZoom={1.5}
          >
            <Background gap={18} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
          {pendingConn && (
            <div
              role="menu"
              style={{
                position: 'absolute',
                left: pendingConn.menuX,
                top: pendingConn.menuY,
                zIndex: 40,
                minWidth: 185,
                padding: 6,
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                boxShadow: '0 12px 32px rgba(0, 0, 0, 0.22)',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <div className="muted" style={{ fontSize: 11, fontWeight: 600, padding: '4px 8px' }}>
                {t('aiChats.script.addNode')}
              </div>
              {ADD_KINDS.map(kind => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  className="row"
                  onClick={() => createConnectedNode(kind)}
                  style={{
                    gap: 8,
                    padding: '6px 8px',
                    border: 0,
                    borderRadius: 6,
                    background: 'transparent',
                    color: 'var(--text)',
                    fontSize: 13,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <Plus size={13} />
                  <span>{t(`aiChats.script.kinds.${kind}`)}</span>
                </button>
              ))}
            </div>
          )}
          {nodes.length === 0 && (
            <div className="ae-empty">
              <span className="muted" style={{ fontSize: 13 }}>{t('aiChats.script.emptyCanvas')}</span>
            </div>
          )}
        </div>

        <SalesScriptInspector
          node={selectedNode}
          edge={selectedEdge}
          onUpdateNode={updateNode}
          onDeleteNode={deleteNode}
          onUpdateEdge={updateEdge}
          onDeleteEdge={deleteEdge}
        />
      </div>
    </div>
  );
}
