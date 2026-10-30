import { expect, test } from 'bun:test';
import { flushQueue, type QueuedAction } from './queue';

test('очередь отправляет операции по порядку с теми же идентификаторами и сохраняет остаток при ошибке', async () => {
  const actions: QueuedAction[] = ['a', 'b'].map(clientId => ({ clientId, workspaceId: 'ws', userId: 'user', path: '/events', body: { clientId } }));
  const sent: string[] = [];
  const deleted: string[] = [];
  await flushQueue(actions, async a => { sent.push(a.clientId); if (a.clientId === 'b') throw new Error('offline'); }, async id => { deleted.push(id); });
  expect(sent).toEqual(['a', 'b']);
  expect(deleted).toEqual(['a']);
});
