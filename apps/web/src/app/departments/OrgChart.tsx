/* Интерактивная оргсхема подразделений: верхний уровень горизонтально, вложенные вертикально с плавным раскрытием */
import * as React from 'react';
import { Building2, ChevronDown, Pencil, Plus, Users } from 'lucide-react';
import { useT } from '@/i18n';
import type { DepartmentItem } from './tree';
import './org-chart.css';

interface OrgChartProps {
  departments: readonly DepartmentItem[];
  nameOf: ReadonlyMap<string, string>;
  isAdmin: boolean;
  expandAll: boolean;
  onEdit: (d: DepartmentItem) => void;
  onAddChild: (parentId: string) => void;
}

interface TreeNode {
  d: DepartmentItem;
  children: TreeNode[];
}

const ICON_PALETTE = [
  { bg: '#fff4ed', fg: '#ea580c' },
  { bg: '#eff6ff', fg: '#2563eb' },
  { bg: '#f5f3ff', fg: '#7c3aed' },
  { bg: '#ecfdf5', fg: '#059669' },
  { bg: '#fefce8', fg: '#ca8a04' },
];

function buildForest(items: readonly DepartmentItem[]): { roots: TreeNode[]; parentOf: Map<string, string | null> } {
  const byId = new Map(items.map(d => [d.id, d]));
  const byParent = new Map<string | null, DepartmentItem[]>();
  const parentOf = new Map<string, string | null>();
  for (const d of items) {
    const pid = d.parentId && byId.has(d.parentId) && d.parentId !== d.id ? d.parentId : null;
    parentOf.set(d.id, pid);
    const list = byParent.get(pid) ?? [];
    list.push(d);
    byParent.set(pid, list);
  }
  const sort = (list: DepartmentItem[]) => [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const seen = new Set<string>();
  const make = (d: DepartmentItem): TreeNode => {
    seen.add(d.id);
    const kids = sort(byParent.get(d.id) ?? []).filter(c => !seen.has(c.id)).map(make);
    return { d, children: kids };
  };
  const roots = sort(byParent.get(null) ?? []).map(make);
  // узлы в циклах, если вдруг попались, не теряем
  for (const d of items) {
    if (!seen.has(d.id)) roots.push(make(d));
  }
  return { roots, parentOf };
}

function getAncestors(id: string, parentOf: Map<string, string | null>): string[] {
  const path: string[] = [];
  let cur: string | null = id;
  const guard = new Set<string>();
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    path.unshift(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return path;
}

function colorFor(id: string, depth: number) {
  if (depth === 0) return ICON_PALETTE[0]!;
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return ICON_PALETTE[(hash % (ICON_PALETTE.length - 1)) + 1]!;
}

export function OrgChart({ departments, nameOf, isAdmin, expandAll, onEdit, onAddChild }: OrgChartProps) {
  const t = useT();
  const { roots, parentOf } = React.useMemo(() => buildForest(departments), [departments]);
  // По умолчанию раскрываем верхний корневой отдел (если он один), чтобы сразу был виден горизонтальный уровень
  const [openPath, setOpenPath] = React.useState<string[]>(() => (roots.length === 1 && roots[0]!.children.length > 0 ? [roots[0]!.d.id] : []));

  React.useEffect(() => {
    setOpenPath(prev => {
      const valid = prev.filter(id => parentOf.has(id));
      if (valid.length > 0) return valid;
      return roots.length === 1 && roots[0]!.children.length > 0 ? [roots[0]!.d.id] : [];
    });
  }, [roots, parentOf]);

  const openSet = React.useMemo(() => new Set(openPath), [openPath]);

  const isExpanded = (node: TreeNode) => node.children.length > 0 && (expandAll || openSet.has(node.d.id));

  const handleToggle = (node: TreeNode) => {
    if (expandAll || node.children.length === 0) return;
    setOpenPath(prev => {
      if (prev[prev.length - 1] === node.d.id) {
        return prev.slice(0, -1);
      }
      return getAncestors(node.d.id, parentOf);
    });
  };

  const renderCard = (node: TreeNode, depth: number) => {
    const { d, children } = node;
    const expanded = isExpanded(node);
    const hasKids = children.length > 0;
    const headText = d.headMemberId
      ? nameOf.get(d.headMemberId) ?? t('departments.settings.unknown')
      : t('departments.settings.noHead');
    const membersText = t('departments.settings.members', { count: d.memberIds.length });
    const col = colorFor(d.id, depth);
    const Icon = depth === 0 ? Building2 : Users;

    return (
      <div
        className={`oc-card${hasKids && !expandAll ? ' is-clickable' : ''}${expanded ? ' is-open' : ''}`}
        role={hasKids && !expandAll ? 'button' : undefined}
        tabIndex={hasKids && !expandAll ? 0 : undefined}
        aria-expanded={hasKids ? expanded : undefined}
        onClick={() => handleToggle(node)}
        onKeyDown={e => {
          if (hasKids && !expandAll && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            handleToggle(node);
          }
        }}
      >
        <div className="oc-card-head">
          <span className="oc-icon" style={{ background: col.bg, color: col.fg }} aria-hidden="true">
            <Icon size={16} />
          </span>
          <div className="oc-meta">
            <div className="oc-name" title={d.name}>{d.name}</div>
            <div className="oc-head-name" title={headText}>{headText}</div>
          </div>
        </div>
        <div className="oc-foot">
          <div className="oc-foot-left">
            {isAdmin && (
              <div className="oc-actions" onClick={e => e.stopPropagation()}>
                <button
                  type="button"
                  className="oc-act-btn"
                  title={t('departments.settings.addChild')}
                  aria-label={t('departments.settings.addChild')}
                  onClick={() => onAddChild(d.id)}
                >
                  <Plus size={13} />
                </button>
                <button
                  type="button"
                  className="oc-act-btn"
                  title={t('departments.settings.edit')}
                  aria-label={t('departments.settings.edit')}
                  onClick={() => onEdit(d)}
                >
                  <Pencil size={12} />
                </button>
              </div>
            )}
            <span className="oc-members">{membersText}</span>
          </div>
          {hasKids && (
            <span className="oc-expand-pill" aria-hidden="true">
              <span>{children.length}</span>
              <ChevronDown size={13} className="oc-chev" />
            </span>
          )}
        </div>
        {expanded && <span className={`oc-dot${depth >= 1 ? ' oc-dot-left' : ''}`} aria-hidden="true" />}
      </div>
    );
  };

  const renderVertical = (node: TreeNode, depth: number): React.ReactNode => {
    const expanded = isExpanded(node);
    return (
      <div key={node.d.id} className="oc-vitem">
        {renderCard(node, depth)}
        {node.children.length > 0 && (
          <div className={`oc-collapse${expanded ? ' is-open' : ''}`}>
            <div className="oc-collapse-inner">
              <div className="oc-vlist">{node.children.map(c => renderVertical(c, depth + 1))}</div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="oc-wrap">
      <div className="oc-roots">
        {roots.map(root => {
          const expanded = isExpanded(root);
          return (
            <div key={root.d.id} className="oc-root-branch">
              {renderCard(root, 0)}
              {root.children.length > 0 && (
                <div className={`oc-collapse${expanded ? ' is-open' : ''}`}>
                  <div className="oc-collapse-inner">
                    <div className="oc-h-stem" />
                    <div className="oc-h-row">
                      {root.children.map(child => {
                        const childExpanded = isExpanded(child);
                        return (
                          <div key={child.d.id} className="oc-h-col">
                            {renderCard(child, 1)}
                            {child.children.length > 0 && (
                              <div className={`oc-collapse${childExpanded ? ' is-open' : ''}`}>
                                <div className="oc-collapse-inner">
                                  <div className="oc-vlist">
                                    {child.children.map(grand => renderVertical(grand, 2))}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
