/* Редактор интерактивной доски: автосохранение, выбор ERP/CRM-карточек, конвертация стикеров в задачи */
import * as React from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CircleAlert, Loader2 } from 'lucide-react';
import { Button, EmptyState, Input, Skeleton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useWorkspace } from '../data/store';
import { call, useWsId } from '../meta/data';
import { WhiteboardCanvas } from './canvas/WhiteboardCanvas';
import type { WbElement, WbErpCard, WbSticky, WbViewport } from './canvas/types';
import { ErpCardPickerDialog, type ErpCardSelection } from './ErpCardPickerDialog';
import { useWhiteboard, useWhiteboardsApi, type WhiteboardDetail } from './data';

const uid = () => `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function WhiteboardEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const board = useWhiteboard(id);

  if (board.isError) {
    return (
      <div className="page">
        <EmptyState
          icon={<CircleAlert size={20} />}
          error
          title={t('whiteboards.loadFailed')}
          action={
            <div className="row" style={{ gap: 8 }}>
              <Button variant="secondary" size="sm" onClick={() => navigate('/whiteboards')}>
                {t('whiteboards.back')}
              </Button>
              <Button size="sm" onClick={() => board.refetch()}>
                {t('common.retry')}
              </Button>
            </div>
          }
        >
          {(board.error as Error).message}
        </EmptyState>
      </div>
    );
  }

  if (board.isPending || !board.data) {
    return (
      <div className="page wide">
        <Skeleton w="100%" h={48} style={{ marginBottom: 12 }} />
        <Skeleton w="100%" h={540} />
      </div>
    );
  }

  return <Editor key={board.data.id} board={board.data} />;
}

function Editor({ board }: { board: WhiteboardDetail }) {
  const t = useT();
  const navigate = useNavigate();
  const ws = useWsId();
  const qc = useQueryClient();
  const { data: wsData } = useWorkspace();
  const api = useWhiteboardsApi();

  const [title, setTitle] = React.useState(board.title);
  const [elements, setElements] = React.useState<WbElement[]>(board.elements);
  const [viewport, setViewport] = React.useState<WbViewport>(board.viewport);
  const [saveState, setSaveState] = React.useState<'saved' | 'saving' | 'error'>('saved');
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const canvasBoxRef = React.useRef<HTMLDivElement | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = React.useRef(false);
  const latestRef = React.useRef({ title: board.title, elements: board.elements, viewport: board.viewport });
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (dirtyRef.current) {
        const snap = latestRef.current;
        void api.update(
          board.id,
          { title: snap.title.trim() || t('whiteboards.defaultTitle'), elements: snap.elements, viewport: snap.viewport },
          true,
        );
      }
    };
  }, [board.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleSave = React.useCallback(
    (next: { title: string; elements: WbElement[]; viewport: WbViewport }) => {
      latestRef.current = next;
      dirtyRef.current = true;
      setSaveState('saving');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const snap = latestRef.current;
        dirtyRef.current = false;
        void api
          .update(
            board.id,
            { title: snap.title.trim() || t('whiteboards.defaultTitle'), elements: snap.elements, viewport: snap.viewport },
            true,
          )
          .then(
            () => {
              if (mountedRef.current && !dirtyRef.current) setSaveState('saved');
            },
            err => {
              if (mountedRef.current) {
                setSaveState('error');
                toast.error(errorMessage(err));
              }
            },
          );
      }, 700);
    },
    [api, board.id, t],
  );

  const handleTitleChange = (nextTitle: string) => {
    setTitle(nextTitle);
    scheduleSave({ title: nextTitle, elements, viewport });
  };

  const handleElementsChange = (nextElements: WbElement[]) => {
    setElements(nextElements);
    scheduleSave({ title, elements: nextElements, viewport });
  };

  const handleViewportChange = (nextViewport: WbViewport) => {
    setViewport(nextViewport);
    scheduleSave({ title, elements, viewport: nextViewport });
  };

  const handleAddErpCard = (card: ErpCardSelection) => {
    const rect = canvasBoxRef.current?.getBoundingClientRect();
    const cx = rect ? (rect.width / 2 - viewport.x) / viewport.zoom : 240;
    const cy = rect ? (rect.height / 2 - viewport.y) / viewport.zoom : 180;
    const nextCard: WbErpCard = {
      id: uid(),
      type: 'erp_card',
      x: Math.round(cx - 120),
      y: Math.round(cy - 52),
      w: 240,
      h: 108,
      entityType: card.entityType,
      entityId: card.entityId,
      title: card.title,
      subtitle: card.subtitle,
      status: card.status,
      done: card.done,
      z: elements.reduce((m, el) => Math.max(m, el.z ?? 0), 0) + 1,
    };
    handleElementsChange([...elements, nextCard]);
  };

  const handleConvertStickyToTask = async (el: WbSticky) => {
    const activeProject = wsData.projects.find(p => !p.archived && p.status !== 'complete') ?? wsData.projects.find(p => !p.archived);
    if (!activeProject) {
      toast.error(t('whiteboards.toast.noProjectForTask'));
      return;
    }
    const taskTitle = el.text.trim().slice(0, 120) || 'Задача с доски';
    try {
      const created = await call<{ id: string; title: string; status: string }>(ws, 'POST', '/tasks', {
        projectId: activeProject.id,
        title: taskTitle,
      });
      void qc.invalidateQueries({ queryKey: ['ws', ws, 'tasks'] });
      const card: WbErpCard = {
        id: el.id,
        type: 'erp_card',
        x: el.x,
        y: el.y,
        w: Math.max(el.w, 220),
        h: Math.max(el.h, 108),
        entityType: 'task',
        entityId: created.id,
        title: created.title,
        subtitle: activeProject.name,
        status: created.status,
        done: created.status === 'done',
        z: el.z ?? 2,
      };
      handleElementsChange(latestRef.current.elements.map(item => (item.id === el.id ? card : item)));
      toast.success(t('whiteboards.toast.taskCreated', { title: created.title }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleToggleTaskCard = async (el: WbErpCard) => {
    const nextDone = !el.done;
    const nextStatus = nextDone ? 'done' : 'todo';
    handleElementsChange(
      elements.map(item => (item.id === el.id && item.type === 'erp_card' ? { ...item, done: nextDone, status: nextStatus } : item)),
    );
    if (el.entityType === 'task' && el.entityId) {
      try {
        await call(ws, 'PATCH', `/tasks/${el.entityId}`, { status: nextStatus });
        void qc.invalidateQueries({ queryKey: ['ws', ws, 'tasks'] });
      } catch (err) {
        toast.error(errorMessage(err));
      }
    }
  };

  const handleOpenErpCard = (el: WbErpCard) => {
    switch (el.entityType) {
      case 'task':
        navigate('/tasks');
        break;
      case 'deal':
        navigate('/crm/deals');
        break;
      case 'client':
        navigate(`/crm/companies/${el.entityId}`);
        break;
      case 'contact':
        navigate('/crm/contacts');
        break;
      case 'lead':
        navigate('/crm/leads');
        break;
    }
  };

  return (
    <div className="page flush">
      <div
        className="row"
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <Button variant="ghost" size="sm" onClick={() => navigate('/whiteboards')}>
          <ArrowLeft size={14} />
          {t('whiteboards.back')}
        </Button>
        <Input
          size="sm"
          value={title}
          placeholder={t('whiteboards.titlePlaceholder')}
          aria-label={t('whiteboards.titlePlaceholder')}
          onChange={e => handleTitleChange(e.target.value)}
          style={{ maxWidth: 320, fontWeight: 600 }}
        />
        <span className="sp" />
        <span className="row muted" style={{ fontSize: 12, gap: 5 }}>
          {saveState === 'saving' ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              {t('whiteboards.saving')}
            </>
          ) : saveState === 'error' ? (
            <span style={{ color: 'var(--red)' }}>{t('whiteboards.saveError')}</span>
          ) : (
            <>
              <Check size={13} style={{ color: 'var(--green)' }} />
              {t('whiteboards.saved')}
            </>
          )}
        </span>
      </div>

      <div ref={canvasBoxRef} style={{ height: 'calc(100dvh - 108px)', minHeight: 360, width: '100%', position: 'relative' }}>
        <WhiteboardCanvas
          elements={elements}
          viewport={viewport}
          title={title || t('whiteboards.defaultTitle')}
          onChange={handleElementsChange}
          onViewportChange={handleViewportChange}
          onAddErpCardClick={() => setPickerOpen(true)}
          onConvertStickyToTask={el => void handleConvertStickyToTask(el)}
          onToggleTaskCard={el => void handleToggleTaskCard(el)}
          onOpenErpCard={handleOpenErpCard}
        />
      </div>

      <ErpCardPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onSelect={handleAddErpCard} />
    </div>
  );
}
