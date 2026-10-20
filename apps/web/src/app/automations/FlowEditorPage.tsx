/* Редактор flow на React Flow: палитра узлов слева, холст, панель параметров справа (форма из zod-схемы узла).
   Черновик сохраняется кнопкой Save; Publish проверяет граф и делает его действующей версией. */
import * as React from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, CircleAlert, CircleCheck, Play, Save, Trash2, Upload } from 'lucide-react';
import {
  NODE_CATEGORIES,
  NODE_CATEGORY_LABELS,
  NODE_LIST,
  defaultParams,
  getNodeDef,
  nodeOutputs,
  validateGraph,
  type AnyNodeDef,
  type FlowGraph,
  type GraphIssue,
} from '@gr8r/shared';
import { Alert, Badge, Button, Dialog, DialogClose, DialogContent, EmptyState, Input, Skeleton, Switch, Tab, Tabs, TabsList, Textarea, toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useIsAdmin } from '../catalog/data';
import { errorMessage } from '../data/api';
import { useFlow, useFlowApi, type FlowDetail } from './data';
import { FlowNodeView, IssuesContext, type RFNode } from './flow-node';
import { ParamsForm, templateVariables, useFormEnv } from './node-form';
import { CATEGORY_COLOR, NodeIcon } from './node-meta';
import { RunsView } from './RunsView';

const nodeTypes = { gr8r: FlowNodeView };
const DRAG_TYPE = 'application/x-gr8r-node';

/* ---------------- граф ⇄ React Flow ---------------- */

const toRfNodes = (g: FlowGraph): RFNode[] => g.nodes.map(n => ({ id: n.id, type: 'gr8r', position: n.position, data: { nodeType: n.type, params: n.params } }));
const toRfEdges = (g: FlowGraph): Edge[] => g.edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle || 'out' }));
const toGraph = (nodes: RFNode[], edges: Edge[]): FlowGraph => ({
  nodes: nodes.map(n => ({ id: n.id, type: n.data.nodeType, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, params: n.data.params })),
  edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle || 'out' })),
});
const edgeId = (source: string, handle: string, target: string) => `${source}:${handle}->${target}`;
const newId = (taken: Set<string>) => {
  for (;;) {
    const id = 'n' + Math.random().toString(36).slice(2, 7);
    if (!taken.has(id)) return id;
  }
};

export function FlowEditorPage() {
  const { id, tab = 'editor' } = useParams();
  const flow = useFlow(id);
  if (flow.isError) return <div className="page"><EmptyState icon={<CircleAlert size={20} />} error title="Could not open the automation" action={<Button size="sm" onClick={() => flow.refetch()}>Retry</Button>}>{(flow.error as Error).message}</EmptyState></div>;
  if (flow.isPending) return <div className="page"><Skeleton w="100%" h={60} /></div>;
  return (
    <ReactFlowProvider>
      <Editor key={flow.data.id} flow={flow.data} tab={tab === 'runs' ? 'runs' : 'editor'} />
    </ReactFlowProvider>
  );
}

function Editor({ flow, tab }: { flow: FlowDetail; tab: 'editor' | 'runs' }) {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const api = useFlowApi();
  const rf = useReactFlow();
  const updateInternals = useUpdateNodeInternals();
  const wrap = React.useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(toRfNodes(flow.graph));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toRfEdges(flow.graph));
  const [name, setName] = React.useState(flow.name);
  const [description, setDescription] = React.useState(flow.description);
  const graph = React.useMemo(() => toGraph(nodes, edges), [nodes, edges]);
  const snapshot = (n: string, d: string, g: FlowGraph) => JSON.stringify({ n, d, g });
  const [saved, setSaved] = React.useState(() => snapshot(flow.name, flow.description, toGraph(toRfNodes(flow.graph), toRfEdges(flow.graph))));
  const dirty = snapshot(name, description, graph) !== saved;
  const [busy, setBusy] = React.useState<'save' | 'publish' | null>(null);
  const [runDialog, setRunDialog] = React.useState(false);

  // ---- проверка графа ----
  const issues = React.useMemo(() => validateGraph(graph), [graph]);
  const issuesByNode = React.useMemo(() => {
    const m = new Map<string, string[]>();
    for (const i of issues) if (i.nodeId) m.set(i.nodeId, [...(m.get(i.nodeId) ?? []), i.message]);
    return m;
  }, [issues]);

  const selected = nodes.find(n => n.selected) ?? null;
  const selectedDef = selected ? getNodeDef(selected.data.nodeType) : undefined;
  const trigger = nodes.find(n => getNodeDef(n.data.nodeType)?.category === 'trigger');
  const triggerDef = trigger && getNodeDef(trigger.data.nodeType);
  const triggerEntity = typeof trigger?.data.params.entity === 'string' ? trigger.data.params.entity : undefined;
  const stepIds = React.useMemo(
    () => nodes.filter(n => n.id !== selected?.id && getNodeDef(n.data.nodeType)?.category !== 'trigger').map(n => ({ id: n.id, label: getNodeDef(n.data.nodeType)?.label ?? n.id })),
    [nodes, selected?.id],
  );
  const env = useFormEnv(triggerEntity, stepIds);
  const readOnly = !isAdmin;

  // ---- редактирование ----
  const select = (id: string | null) => setNodes(ns => ns.map(n => (n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })));

  const addNode = React.useCallback(
    (def: AnyNodeDef, at?: { x: number; y: number }) => {
      if (readOnly) return;
      if (def.category === 'trigger' && nodes.some(n => getNodeDef(n.data.nodeType)?.category === 'trigger')) {
        toast.error('A flow has exactly one trigger');
        return;
      }
      const id = newId(new Set(nodes.map(n => n.id)));
      const params = defaultParams(def);
      if (def.category !== 'trigger' && 'entity' in params && triggerEntity && def.type !== 'action.add_comment') params.entity = triggerEntity;
      // Новый узел подключается к выбранному (или последнему без продолжения) через его первый свободный выход
      const src = def.category === 'trigger' ? undefined : (selected ?? [...nodes].reverse().find(n => !edges.some(e => e.source === n.id)));
      const srcDef = src && getNodeDef(src.data.nodeType);
      const freeOut = src && srcDef ? nodeOutputs(srcDef, src.data.params).find(o => !edges.some(e => e.source === src.id && (e.sourceHandle ?? 'out') === o.id)) : undefined;
      let pos = at;
      if (!pos) {
        if (src) {
          const idx = srcDef ? nodeOutputs(srcDef, src.data.params).findIndex(o => o.id === freeOut?.id) : 0;
          pos = { x: src.position.x + 262, y: src.position.y + Math.max(0, idx) * 120 };
        } else if (nodes.length) pos = { x: Math.max(...nodes.map(n => n.position.x)) + 262, y: 80 };
        else pos = { x: 60, y: 100 };
      }
      while (nodes.some(n => Math.abs(n.position.x - pos!.x) < 60 && Math.abs(n.position.y - pos!.y) < 60)) pos = { x: pos.x, y: pos.y + 130 };
      const node: RFNode = { id, type: 'gr8r', position: pos, data: { nodeType: def.type, params }, selected: true };
      setNodes(ns => [...ns.map(n => (n.selected ? { ...n, selected: false } : n)), node]);
      if (src && freeOut && def.category !== 'trigger') setEdges(es => [...es, { id: edgeId(src.id, freeOut.id, id), source: src.id, target: id, sourceHandle: freeOut.id }]);
      setTimeout(() => void rf.fitView({ padding: 0.3, maxZoom: 1, duration: 200 }), 60);
    },
    [nodes, edges, selected, triggerEntity, readOnly, rf, setNodes, setEdges],
  );

  const isValidConnection = React.useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      const t = nodes.find(n => n.id === c.target);
      if (!t || getNodeDef(t.data.nodeType)?.category === 'trigger') return false;
      return !edges.some(e => e.target === c.target); // у узла одна входящая связь: слияния запрещены
    },
    [nodes, edges],
  );
  const onConnect = React.useCallback(
    (c: Connection) => {
      if (!isValidConnection(c)) {
        toast.error('A step can have only one incoming connection');
        return;
      }
      setEdges(es => addEdge({ ...c, id: edgeId(c.source, c.sourceHandle ?? 'out', c.target), sourceHandle: c.sourceHandle ?? 'out' }, es));
    },
    [isValidConnection, setEdges],
  );

  const updateParams = (nodeId: string, params: Record<string, unknown>) => {
    const n = nodes.find(x => x.id === nodeId);
    const def = n && getNodeDef(n.data.nodeType);
    if (!n || !def) return;
    setNodes(ns => ns.map(x => (x.id === nodeId ? { ...x, data: { ...x.data, params } } : x)));
    // Выходы могут измениться (ветвление): связи с исчезнувших выходов удаляются
    const outs = new Set(nodeOutputs(def, params).map(o => o.id));
    setEdges(es => es.filter(e => e.source !== nodeId || outs.has(e.sourceHandle ?? 'out')));
    requestAnimationFrame(() => updateInternals(nodeId));
  };

  const removeSelected = () => selected && void rf.deleteElements({ nodes: [{ id: selected.id }] });

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const def = getNodeDef(e.dataTransfer.getData(DRAG_TYPE));
    if (def) addNode(def, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  // ---- сохранение и публикация ----
  const save = async (): Promise<boolean> => {
    setBusy('save');
    try {
      await api.save(flow.id, { name: name.trim() || 'Untitled automation', description, graph });
      setSaved(snapshot(name, description, graph));
      return true;
    } catch {
      return false;
    } finally {
      setBusy(null);
    }
  };
  const publish = async () => {
    if (issues.length) {
      toast.error(`Fix ${issues.length} issue${issues.length === 1 ? '' : 's'} before publishing`);
      return;
    }
    if (dirty && !(await save())) return;
    setBusy('publish');
    try {
      const f = await api.publish(flow.id, flow.publishedVersion === null ? true : undefined);
      toast(`Published version ${f.publishedVersion}${f.enabled ? ' — the automation is on' : ''}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const toggle = (enabled: boolean) => void api.save(flow.id, { enabled }).then(() => toast(enabled ? 'Automation is on' : 'Automation is off'));
  const start = async (body: { entity?: string; recordId?: string }) => {
    await api.runNow(flow.id, body);
    toast('Run started');
    navigate(`/automations/flow/${flow.id}/runs`);
  };

  const needsRecord = triggerDef?.type === 'trigger.manual' && !!trigger?.data.params.entity;
  const canRun = isAdmin && flow.publishedVersion !== null && triggerDef?.type === 'trigger.manual';
  const status = flow.publishedVersion === null ? <Badge tone="gray">Draft</Badge> : <Badge tone={flow.enabled ? 'green' : 'neutral'} dot>{flow.enabled ? `Live · v${flow.publishedVersion}` : `Off · v${flow.publishedVersion}`}</Badge>;

  return (
    <IssuesContext.Provider value={issuesByNode}>
      <div className="page flush auto-editor">
        <div className="ae-bar">
          <Button size="sm" variant="ghost" aria-label="Back to automations" onClick={() => navigate('/automations')}>
            <ArrowLeft size={14} />
          </Button>
          <Input className="ae-name" aria-label="Automation name" value={name} disabled={readOnly} onChange={e => setName(e.target.value)} />
          {status}
          {(flow.hasDraftChanges || dirty) && flow.publishedVersion !== null && <Badge tone="amber">unpublished changes</Badge>}
          <span className="sp" />
          <span className={cn('ae-valid', issues.length ? 'bad' : 'ok')} role="status">
            {issues.length ? (
              <>
                <CircleAlert size={13} /> {issues.length} issue{issues.length === 1 ? '' : 's'}
              </>
            ) : (
              <>
                <CircleCheck size={13} /> Graph is valid
              </>
            )}
          </span>
          {isAdmin && (
            <>
              <label className="row ae-sw" title={flow.publishedVersion === null ? 'Publish first' : undefined}>
                <Switch checked={flow.enabled} disabled={flow.publishedVersion === null} onChange={e => toggle(e.target.checked)} aria-label="Enabled" />
                <span>Enabled</span>
              </label>
              {canRun && (
                <Button size="sm" variant="secondary" onClick={() => (needsRecord ? setRunDialog(true) : void start({}))}>
                  <Play size={13} />
                  Run
                </Button>
              )}
              <Button size="sm" variant="secondary" disabled={!dirty} loading={busy === 'save'} onClick={() => void save().then(ok => ok && toast('Draft saved'))}>
                <Save size={13} />
                Save draft
              </Button>
              <Button size="sm" variant="primary" disabled={!dirty && !flow.hasDraftChanges && flow.publishedVersion !== null} loading={busy === 'publish'} onClick={publish}>
                <Upload size={13} />
                Publish
              </Button>
            </>
          )}
        </div>
        <Tabs value={tab} onValueChange={v => navigate(v === 'runs' ? `/automations/flow/${flow.id}/runs` : `/automations/flow/${flow.id}`)} className="auto-tabs">
          <TabsList>
            <Tab value="editor">Editor</Tab>
            <Tab value="runs">Runs</Tab>
          </TabsList>
        </Tabs>

        {tab === 'runs' && <RunsView flowId={flow.id} />}

        <div className="ae-body" hidden={tab === 'runs'}>
          <aside className="ae-palette" aria-label="Node palette">
            {NODE_CATEGORIES.map(cat => (
              <section key={cat}>
                <h3>{NODE_CATEGORY_LABELS[cat]}</h3>
                {NODE_LIST.filter(d => d.category === cat).map(d => (
                  <button
                    key={d.type}
                    type="button"
                    className="pal-item"
                    draggable={!readOnly}
                    disabled={readOnly}
                    title={d.description}
                    data-node-type={d.type}
                    style={{ '--fn-c': CATEGORY_COLOR[cat] } as React.CSSProperties}
                    onDragStart={e => e.dataTransfer.setData(DRAG_TYPE, d.type)}
                    onClick={() => addNode(d)}
                  >
                    <span className="fn-ico">
                      <NodeIcon name={d.icon} size={13} />
                    </span>
                    <span className="trunc">{d.label}</span>
                  </button>
                ))}
              </section>
            ))}
            <p className="faint pal-help">Click to add a step after the selected one, or drag it onto the canvas.</p>
          </aside>

          <div className="ae-canvas" ref={wrap} onDrop={onDrop} onDragOver={e => e.preventDefault()}>
            <ReactFlow
              nodes={nodes}
              edges={edges.map(e => {
                const s = nodes.find(n => n.id === e.source);
                const d = s && getNodeDef(s.data.nodeType);
                const outs = d ? nodeOutputs(d, s.data.params) : [];
                return { ...e, label: outs.length > 1 ? outs.find(o => o.id === (e.sourceHandle ?? 'out'))?.label : undefined, markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--text-4)' } };
              })}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              nodesDraggable={!readOnly}
              nodesConnectable={!readOnly}
              elementsSelectable
              deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
              fitView
              fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
              minZoom={0.3}
              maxZoom={1.6}
              proOptions={{ hideAttribution: true }}
              onPaneClick={() => select(null)}
              aria-label="Flow canvas"
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable ariaLabel="Flow overview" nodeColor={n => CATEGORY_COLOR[getNodeDef((n as RFNode).data.nodeType)?.category ?? 'action']} maskColor="color-mix(in srgb, var(--bg) 70%, transparent)" />
            </ReactFlow>
            {!nodes.length && (
              <div className="ae-empty">
                <EmptyState icon={<Play size={20} />} title="Start with a trigger">
                  Pick a trigger in the palette — for example “Field changed” — then add conditions and actions after it.
                </EmptyState>
              </div>
            )}
          </div>

          <aside className="ae-panel" aria-label="Properties">
            {selected && selectedDef ? (
              <NodePanel key={selected.id} nodeId={selected.id} def={selectedDef} params={selected.data.params} env={env} readOnly={readOnly} issues={issuesByNode.get(selected.id) ?? []} onChange={p => updateParams(selected.id, p)} onRemove={removeSelected} />
            ) : (
              <FlowPanel name={name} description={description} setDescription={setDescription} issues={issues} nodes={nodes} onPick={select} env={env} triggerField={typeof trigger?.data.params.field === 'string' ? trigger.data.params.field : undefined} readOnly={readOnly} />
            )}
          </aside>
        </div>
        {runDialog && <RunDialog entity={String(trigger?.data.params.entity ?? '')} onClose={() => setRunDialog(false)} onRun={start} />}
      </div>
    </IssuesContext.Provider>
  );
}

/* ---------------- панели ---------------- */

function NodePanel({ nodeId, def, params, env, readOnly, issues, onChange, onRemove }: { nodeId: string; def: AnyNodeDef; params: Record<string, unknown>; env: ReturnType<typeof useFormEnv>; readOnly: boolean; issues: string[]; onChange: (p: Record<string, unknown>) => void; onRemove: () => void }) {
  // Ошибки схемы по именам параметров — под полями формы
  const errors = React.useMemo(() => {
    const r = def.params.safeParse(params);
    const out: Record<string, string> = {};
    if (!r.success) for (const i of r.error.issues as { path: PropertyKey[]; message: string }[]) out[String(i.path[0] ?? '')] ??= i.message;
    return out;
  }, [def, params]);
  return (
    <div className="ae-p">
      <div className="ae-ph" style={{ '--fn-c': CATEGORY_COLOR[def.category] } as React.CSSProperties}>
        <span className="fn-ico">
          <NodeIcon name={def.icon} size={14} />
        </span>
        <div>
          <h2>{def.label}</h2>
          <p className="faint">{def.description}</p>
        </div>
      </div>
      <ParamsForm def={def} params={params} env={env} errors={errors} readOnly={readOnly} onChange={onChange} />
      {issues.length > 0 && (
        <Alert tone="warn" title="Needs attention">
          {issues.join(' · ')}
        </Alert>
      )}
      <div className="faint ae-nid">
        Node ID <span className="mono">{nodeId}</span> — use <span className="mono">{`{{steps.${nodeId}.…}}`}</span> in later steps.
      </div>
      {!readOnly && (
        <Button variant="secondary" size="sm" onClick={onRemove}>
          <Trash2 size={13} />
          Delete step
        </Button>
      )}
    </div>
  );
}

function FlowPanel({ name, description, setDescription, issues, nodes, onPick, env, triggerField, readOnly }: { name: string; description: string; setDescription: (v: string) => void; issues: GraphIssue[]; nodes: RFNode[]; onPick: (id: string) => void; env: ReturnType<typeof useFormEnv>; triggerField?: string; readOnly: boolean }) {
  const vars = React.useMemo(() => templateVariables(env, triggerField), [env, triggerField]);
  return (
    <div className="ae-p">
      <div className="ae-ph">
        <div>
          <h2>{name || 'Automation'}</h2>
          <p className="faint">Select a step to edit its parameters.</p>
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="ae-desc">
          Description
        </label>
        <Textarea id="ae-desc" rows={3} value={description} disabled={readOnly} onChange={e => setDescription(e.target.value)} />
      </div>
      <div>
        <div className="label">Checks</div>
        {issues.length ? (
          <ul className="ae-issues">
            {issues.map((i, k) => (
              <li key={k}>
                {i.nodeId && nodes.some(n => n.id === i.nodeId) ? (
                  <button type="button" onClick={() => onPick(i.nodeId!)}>
                    {i.message}
                  </button>
                ) : (
                  i.message
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="faint">One trigger, no dangling steps, all parameters valid.</p>
        )}
      </div>
      <details className="ae-vars">
        <summary>Variables for {'{{…}}'}</summary>
        <p className="faint">Any text parameter can use values from the trigger and earlier steps. Missing values become empty text.</p>
        {vars.map(g => (
          <div key={g.group}>
            <div className="label">{g.group}</div>
            <div className="mono ae-varlist">{g.items.map(v => `{{${v}}}`).join('  ')}</div>
          </div>
        ))}
      </details>
    </div>
  );
}

function RunDialog({ entity, onClose, onRun }: { entity: string; onClose: () => void; onRun: (b: { entity?: string; recordId?: string }) => Promise<void> }) {
  const [id, setId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title="Run on a record"
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              variant="primary"
              disabled={!valid}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onRun({ entity, recordId: id.trim() });
                  onClose();
                } finally {
                  setBusy(false);
                }
              }}
            >
              Run
            </Button>
          </>
        }
      >
        <div className="field">
          <label className="label" htmlFor="run-rec">
            {entity} record ID
          </label>
          <Input id="run-rec" className="mono" value={id} onChange={e => setId(e.target.value)} placeholder="UUID of the record" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
