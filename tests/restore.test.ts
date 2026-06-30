// tests/restore.test.ts
import { describe, it, expect } from 'vitest';
import { diffSnapshot, canApplyRestore, revertFields } from '../src/restore.js';
import type { JiraHttpClient } from '../src/types.js';
import type { RawIssue } from '../src/snapshot.js';

function issue(overrides: Partial<RawIssue> & { key: string }): RawIssue {
  return {
    key: overrides.key,
    project: overrides.project ?? 'PROJ',
    issuetype: overrides.issuetype ?? 'Task',
    summary: overrides.summary ?? 'Default summary',
    description: overrides.description ?? null,
    status: overrides.status ?? 'To Do',
    assignee: overrides.assignee ?? null,
    parentKey: overrides.parentKey ?? null,
    labels: overrides.labels ?? [],
    start: overrides.start ?? null,
    due: overrides.due ?? null,
    estimateHours: overrides.estimateHours ?? null,
    priority: overrides.priority ?? null,
    links: overrides.links ?? [],
  };
}

// ---------------------------------------------------------------------------
// diffSnapshot
// ---------------------------------------------------------------------------

describe('diffSnapshot', () => {
  it('renvoie un diff vide quand identiques', () => {
    const issues = [issue({ key: 'PROJ-1', summary: 'Hello' })];
    const diff = diffSnapshot(issues, issues);
    expect(diff.toRevert).toHaveLength(0);
    expect(diff.missingNow).toHaveLength(0);
    expect(diff.extraNow).toHaveLength(0);
  });

  it('détecte un summary changé', () => {
    const diff = diffSnapshot(
      [issue({ key: 'PROJ-1', summary: 'New title' })],
      [issue({ key: 'PROJ-1', summary: 'Old title' })],
    );
    expect(diff.toRevert).toHaveLength(1);
    expect(diff.toRevert[0]).toMatchObject({ key: 'PROJ-1', field: 'summary', current: 'New title', snapshot: 'Old title' });
  });

  it('détecte un statut changé', () => {
    const diff = diffSnapshot([issue({ key: 'PROJ-1', status: 'Done' })], [issue({ key: 'PROJ-1', status: 'To Do' })]);
    const d = diff.toRevert.find((x) => x.field === 'status');
    expect(d?.current).toBe('Done');
    expect(d?.snapshot).toBe('To Do');
  });

  it('labels ordre-indépendant : même contenu = pas de diff', () => {
    const diff = diffSnapshot(
      [issue({ key: 'PROJ-1', labels: ['b', 'a'] })],
      [issue({ key: 'PROJ-1', labels: ['a', 'b'] })],
    );
    expect(diff.toRevert.find((d) => d.field === 'labels')).toBeUndefined();
  });

  it('détecte un label ajouté', () => {
    const diff = diffSnapshot(
      [issue({ key: 'PROJ-1', labels: ['a', 'new'] })],
      [issue({ key: 'PROJ-1', labels: ['a'] })],
    );
    expect(diff.toRevert.find((d) => d.field === 'labels')).toBeDefined();
  });

  it('signale missingNow pour les issues absentes du live', () => {
    const diff = diffSnapshot([], [issue({ key: 'PROJ-1' })]);
    expect(diff.missingNow).toContain('PROJ-1');
    expect(diff.toRevert).toHaveLength(0);
  });

  it('signale extraNow pour les issues créées après le snapshot', () => {
    const diff = diffSnapshot([issue({ key: 'PROJ-NEW' })], []);
    expect(diff.extraNow).toContain('PROJ-NEW');
    expect(diff.toRevert).toHaveLength(0);
  });

  it('ne crée pas de toRevert pour les missingNow', () => {
    const diff = diffSnapshot(
      [issue({ key: 'PROJ-1', summary: 'present' })],
      [issue({ key: 'PROJ-1', summary: 'present' }), issue({ key: 'PROJ-GONE', summary: 'was here' })],
    );
    expect(diff.toRevert.every((d) => d.key !== 'PROJ-GONE')).toBe(true);
    expect(diff.missingNow).toContain('PROJ-GONE');
  });
});

// ---------------------------------------------------------------------------
// canApplyRestore
// ---------------------------------------------------------------------------

describe('canApplyRestore', () => {
  it('false sans args', () => expect(canApplyRestore([])).toBe(false));
  it('false avec seulement --apply', () => expect(canApplyRestore(['--apply'])).toBe(false));
  it('false avec seulement --yes-i-want-to-overwrite-jira', () => expect(canApplyRestore(['--yes-i-want-to-overwrite-jira'])).toBe(false));
  it('true avec les deux flags', () => expect(canApplyRestore(['--apply', '--yes-i-want-to-overwrite-jira'])).toBe(true));
  it('true peu importe l\'ordre', () => expect(canApplyRestore(['--yes-i-want-to-overwrite-jira', '--apply'])).toBe(true));
  it('false en cas de typo', () => expect(canApplyRestore(['--apply', '--yes-i-want-to-overwrite-jir'])).toBe(false));
});

// ---------------------------------------------------------------------------
// revertFields
// ---------------------------------------------------------------------------

describe('revertFields', () => {
  function makeClient(fetchFn: typeof fetch): JiraHttpClient {
    return { baseUrl: 'https://fake.atlassian.net', authHeader: 'Basic fake', fetchFn };
  }

  it('succès sur summary (HTTP 204)', async () => {
    const client = makeClient(async (url) => {
      if (url.toString().includes('rest/api/3/issue/PROJ-1')) return new Response(null, { status: 204 });
      return new Response('Not Found', { status: 404 });
    });
    const result = await revertFields(client, [{ key: 'PROJ-1', field: 'summary', current: 'New', snapshot: 'Old' }]);
    expect(result.succeeded).toContain('PROJ-1:fields');
    expect(result.failed).toHaveLength(0);
  });

  it('enregistre l\'échec quand JIRA renvoie 400', async () => {
    const client = makeClient(async () => new Response('Bad Request', { status: 400 }));
    const result = await revertFields(client, [{ key: 'PROJ-2', field: 'summary', current: 'New', snapshot: 'Old' }]);
    expect(result.failed.length).toBeGreaterThan(0);
    expect(result.failed[0].key).toBe('PROJ-2');
  });

  it('gère la transition de statut via transitions endpoint', async () => {
    const client = makeClient(async (url, init) => {
      const u = url.toString();
      if (u.includes('transitions')) {
        if (init?.method === 'POST') return new Response(null, { status: 204 });
        return new Response(JSON.stringify({ transitions: [{ id: '31', to: { name: 'To Do' } }] }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    });
    const result = await revertFields(client, [{ key: 'PROJ-1', field: 'status', current: 'Done', snapshot: 'To Do' }]);
    expect(result.succeeded).toContain('PROJ-1:status');
    expect(result.failed).toHaveLength(0);
  });

  it('enregistre l\'échec si la transition cible est introuvable', async () => {
    const client = makeClient(async () =>
      new Response(JSON.stringify({ transitions: [{ id: '10', to: { name: 'In Progress' } }] }), { status: 200 }),
    );
    const result = await revertFields(client, [{ key: 'PROJ-1', field: 'status', current: 'Done', snapshot: 'To Do' }]);
    expect(result.failed.some((f) => f.key === 'PROJ-1' && f.field === 'status')).toBe(true);
  });

  it('liste vide → résultats vides', async () => {
    const client = makeClient(async () => new Response(null, { status: 204 }));
    const result = await revertFields(client, []);
    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });
});
