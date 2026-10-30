import { describe, expect, test } from 'bun:test';
import { Client, addMember } from './helpers';

describe('личное избранное', () => {
  test('проект и задача в избранном только у того, кто их отметил', async () => {
    const a = new Client();
    await a.signup();
    const b = await addMember(a);
    const p = await a.project('FAV', 'Fav project');
    const t = await a.task(p.id, 'Fav task');
    expect((await a.get(`/projects/${p.id}`)).body.fav).toBe(false);

    expect((await a.patch(`/projects/${p.id}`, { fav: true })).body.fav).toBe(true);
    expect((await a.patch(`/tasks/${t.id}`, { fav: true })).body.fav).toBe(true);

    expect((await a.get(`/projects/${p.id}`)).body.fav).toBe(true);
    expect((await b.get(`/projects/${p.id}`)).body.fav).toBe(false);
    expect((await b.get(`/tasks/${t.id}`)).body.fav).toBe(false);
    expect((await a.get('/projects?fav=true')).body.items.map((x: any) => x.id)).toEqual([p.id]);
    expect((await b.get('/projects?fav=true')).body.items).toHaveLength(0);
    expect((await a.get('/tasks?fav=true')).body.items.map((x: any) => x.id)).toEqual([t.id]);
    expect((await b.get('/tasks?fav=true')).body.items).toHaveLength(0);

    expect((await a.patch(`/projects/${p.id}`, { fav: false })).body.fav).toBe(false);
    expect((await a.get('/projects?fav=true')).body.items).toHaveLength(0);
  });
});
