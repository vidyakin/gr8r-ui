/* Диалог «Create workspace» из меню воркспейса: POST /workspaces, затем переключение на новый воркспейс. */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { Button, Dialog, DialogClose, DialogContent, Field, Input, toast } from '@/components/ui';
import { apiFor, errorMessage, ok } from '../data/api';
import { useSession, type WorkspaceRef } from '../data/session';

export function NewWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const session = useSession();
  const navigate = useNavigate();
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName('');
      setError('');
      setBusy(false);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError('Name your workspace to continue');
    setBusy(true);
    try {
      const created = await ok<WorkspaceRef>(apiFor().workspaces.$post({ json: { name: n } }));
      await session.refreshWorkspaces();
      session.switchWorkspace(created.id);
      onOpenChange(false);
      navigate('/');
      toast(`Switched to ${created.name}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title="Create workspace"
        description="A separate space with its own projects, tasks, CRM and members. You will be its owner."
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant="primary" type="submit" form="new-workspace-form" loading={busy}>
              Create workspace
            </Button>
          </>
        }
      >
        <form id="new-workspace-form" onSubmit={submit} noValidate>
          <Field label="Workspace name" error={error}>
            {p => <Input {...p} autoFocus value={name} placeholder="e.g. Acme Corp" onChange={e => setName(e.target.value)} />}
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
