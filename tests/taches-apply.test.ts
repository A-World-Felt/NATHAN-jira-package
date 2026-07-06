// tests/taches-apply.test.ts
import { describe, it, expect } from 'vitest';
import { checkChanges, dryRun, canApply, applyChanges, type ChangeSet } from '../src/taches-apply.js';
import { indexSnapshot } from '../src/snapshot.js';
import type { RawIssue } from '../src/snapshot.js';

function iss(p: Partial<RawIssue> & { key: string }): RawIssue {
  return {
    key: p.key, project: p.project ?? 'GES', issuetype: p.issuetype ?? 'Tâche',
    summary: p.summary ?? '', description: null, status: p.status ?? 'À faire',
    assignee: null, parentKey: null, labels: p.labels ?? [], start: null, due: null,
    estimateHours: null, priority: null, links: [],
  };
}

const ISSUES: RawIssue[] = [
  iss({ key: 'GES-66', issuetype: 'Epic' }),
  iss({ key: 'GES-80' }),
  iss({ key: 'GES-90' }),
];
const idx = indexSnapshot(ISSUES);

describe('canApply', () => {
  it('exige la double garde', () => {
    expect(canApply(['apply'])).toBe(false);
    expect(canApply(['apply', '--yes-i-want-to-write-jira'])).toBe(true);
  });
});

describe('checkChanges', () => {
  it('résout création + maj (dépendance sur une clé JIRA existante) sans avertissement', () => {
    const cs: ChangeSet = {
      create: [{ idV2: 'NEW-1', nom: 'Nouvelle tâche', projet: 'GES', epic: 'GES-66', statutInitial: 'À faire', dependsOn: [{ ref: 'GES-80', type: 'FS' }] }],
      update: [{ ref: 'GES-90', statut: 'En cours' }],
    };
    const c = checkChanges(cs, idx);
    expect(c.warnings).toEqual([]);
    expect(c.errors).toEqual([]);
    expect(c.createCount).toBe(1);
    expect(c.updateCount).toBe(1);
    expect(c.linkCount).toBe(1);
  });

  it('alerte epic manquant et ref introuvable (plus de notion de doublon nid)', () => {
    const cs: ChangeSet = {
      create: [{ idV2: 'NEW-2', nom: 'X', projet: 'GES', epic: 'GES-999', statutInitial: 'À faire' }],
      update: [{ ref: 'GES-INCONNU', statut: 'En cours' }],
    };
    const w = checkChanges(cs, idx).warnings.join(' ');
    expect(w).toContain('GES-999 introuvable');
    expect(w).toContain('GES-INCONNU');
    expect(w).toContain('introuvable');
    expect(w).not.toContain('nid');
  });

  it('détecte un résumé non conforme (markdown) → errors bloquantes', () => {
    const cs: ChangeSet = {
      create: [{ idV2: 'NEW-3', nom: '**Titre gras**', projet: 'GES', epic: 'GES-66', statutInitial: 'À faire' }],
    };
    const c = checkChanges(cs, idx);
    expect(c.errors.length).toBeGreaterThan(0);
    expect(c.errors[0]).toContain('résumé non conforme');
  });
});

describe('dryRun', () => {
  it('imprime créations et mises à jour, référencées par clé JIRA (pas de nid)', () => {
    const cs: ChangeSet = {
      create: [{ idV2: 'NEW-4', nom: 'Nouvelle', projet: 'GES', epic: 'GES-66', statutInitial: 'À faire' }],
      update: [{ ref: 'GES-90', statut: 'En cours', fin: '2026-07-01' }],
    };
    const out = dryRun(cs, idx);
    expect(out).toContain('CRÉATIONS');
    expect(out).toContain('NEW-4');
    expect(out).toContain('MISES À JOUR');
    expect(out).toContain('GES-90');
    expect(out).toContain('statut→"En cours"');
    expect(out).not.toContain('nid');
  });
});

describe('sous-tâches', () => {
  it('checkChanges compte les sous-tâches sans avertissement de doublon nid', () => {
    const cs: ChangeSet = {
      create: [{
        idV2: 'SEC-s8', nom: 'Secrétaire s8', projet: 'GES', epic: 'GES-66', statutInitial: 'À faire',
        subtasks: [
          { idV2: 'SEC-s8-1', nom: 'Ordre du jour' },
          { idV2: 'SEC-s8-2', nom: 'Tableau de bord' },
        ],
      }],
    };
    const c = checkChanges(cs, idx);
    expect(c.subtaskCount).toBe(2);
    expect(c.warnings).toEqual([]);
  });

  it('applyChanges crée les sous-tâches sous le parent (Sous-tâche) sans label nid-', async () => {
    const created: Array<{ type: string; parent?: string; labels?: string[] }> = [];
    let n = 300;
    const fetchFn = (async (url: string, opts: any) => {
      const u = String(url); const m = opts?.method ?? 'GET';
      if (u.endsWith('/issue') && m === 'POST') {
        const body = JSON.parse(opts.body);
        created.push({ type: body.fields?.issuetype?.name, parent: body.fields?.parent?.key, labels: body.fields?.labels });
        return new Response(JSON.stringify({ key: `GES-${n++}` }), { status: 201 });
      }
      if (u.includes('?fields=status')) return new Response(JSON.stringify({ fields: { status: { name: 'À faire' } } }), { status: 200 });
      if (u.endsWith('/transitions') && m === 'GET') return new Response(JSON.stringify({ transitions: [] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = { baseUrl: 'https://x', authHeader: 'Basic x', startFieldId: 'customfield_1', fetchFn };
    const cs: ChangeSet = {
      create: [{ idV2: 'SEC-s8', nom: 'Secrétaire s8', projet: 'GES', epic: 'GES-66', statutInitial: 'À faire',
        subtasks: [{ idV2: 'SEC-s8-1', nom: 'Ordre du jour' }, { idV2: 'SEC-s8-2', nom: 'Tableau de bord' }] }],
    };
    const r = await applyChanges(client, cs, idx, ISSUES);
    expect(r.created).toHaveLength(1);
    expect(r.subtasks).toHaveLength(2);
    const subs = created.filter((c) => c.type === 'Sous-tâche');
    expect(subs).toHaveLength(2);
    expect(subs[0].parent).toBe('GES-300');
    expect(subs[0].labels ?? []).not.toContain(expect.stringMatching(/^nid-/));
  });
});

describe('suppressions', () => {
  it('checkChanges compte les delete et alerte ref introuvable', () => {
    const cs: ChangeSet = { delete: [{ ref: 'GES-90' }, { ref: 'GES-INCONNU' }] };
    const c = checkChanges(cs, idx);
    expect(c.deleteCount).toBe(2);
    expect(c.warnings.join(' ')).toContain('GES-INCONNU');
  });

  it('applyChanges supprime par clé JIRA quand aucune erreur', async () => {
    const deleted: string[] = [];
    const fetchFn = (async (url: string, opts: any) => {
      const u = String(url); const m = opts?.method ?? 'GET';
      if (u.includes('?deleteSubtasks') && m === 'DELETE') { deleted.push(u); return new Response(null, { status: 204 }); }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = { baseUrl: 'https://x', authHeader: 'Basic x', startFieldId: 'customfield_1', fetchFn };
    const r = await applyChanges(client, { delete: [{ ref: 'GES-90' }, { ref: 'GES-80' }] }, idx, ISSUES);
    expect(r.deleted).toEqual(['GES-90', 'GES-80']);
    expect(r.errors).toEqual([]);
    expect(deleted).toHaveLength(2);
  });

  it('n\'exécute pas les suppressions si une erreur est survenue (garde)', async () => {
    const deleted: string[] = [];
    const fetchFn = (async (url: string, opts: any) => {
      const u = String(url); const m = opts?.method ?? 'GET';
      if (u.endsWith('/issue') && m === 'POST') return new Response('boom', { status: 500 });
      if (u.includes('?deleteSubtasks') && m === 'DELETE') { deleted.push(u); return new Response(null, { status: 204 }); }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = { baseUrl: 'https://x', authHeader: 'Basic x', startFieldId: 'customfield_1', fetchFn };
    const cs: ChangeSet = {
      create: [{ idV2: 'NEW-5', nom: 'X', projet: 'GES', epic: 'GES-66', statutInitial: 'À faire' }],
      delete: [{ ref: 'GES-90' }],
    };
    const r = await applyChanges(client, cs, idx, ISSUES);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.deleted).toEqual([]);
    expect(deleted).toHaveLength(0);
  });
});

describe('applyChanges (client simulé)', () => {
  it('crée (labels sans nid-), met à jour (PUT + transition) et lie par clé JIRA', async () => {
    const calls: string[] = [];
    const createdLabels: string[][] = [];
    let n = 200;
    const fetchFn = (async (url: string, opts: any) => {
      const u = String(url); const m = opts?.method ?? 'GET';
      if (u.endsWith('/issue') && m === 'POST') {
        calls.push('create');
        const body = JSON.parse(opts.body);
        createdLabels.push(body.fields?.labels ?? []);
        return new Response(JSON.stringify({ key: `GES-${n++}` }), { status: 201 });
      }
      if (u.match(/\/issue\/[^/]+$/) && m === 'PUT') { calls.push('put'); return new Response(null, { status: 204 }); }
      if (u.includes('?fields=status')) return new Response(JSON.stringify({ fields: { status: { name: 'À faire' } } }), { status: 200 });
      if (u.endsWith('/transitions') && m === 'GET') return new Response(JSON.stringify({ transitions: [{ id: '1', to: { name: 'En cours' } }] }), { status: 200 });
      if (u.endsWith('/transitions') && m === 'POST') return new Response(null, { status: 204 });
      if (u.endsWith('/issueLink') && m === 'POST') { calls.push('link'); return new Response(null, { status: 201 }); }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = { baseUrl: 'https://x', authHeader: 'Basic x', startFieldId: 'customfield_1', fetchFn };
    const cs: ChangeSet = {
      create: [{ idV2: 'NEW-6', nom: 'Nouvelle', projet: 'GES', epic: 'GES-66', statutInitial: 'À faire', dependsOn: [{ ref: 'GES-80', type: 'FS' }], labels: ['role-ENG'] }],
      update: [{ ref: 'GES-90', statut: 'En cours', fin: '2026-07-01', addLabels: ['urgent'] }],
    };
    const r = await applyChanges(client, cs, idx, ISSUES);
    expect(r.created).toHaveLength(1);
    expect(r.updated).toHaveLength(1);
    expect(r.links).toHaveLength(1);
    expect(r.links[0]).toEqual({ prereq: 'GES-80', task: 'GES-200', type: 'FS' });
    expect(r.errors).toEqual([]);
    expect(calls.filter((c) => c === 'put')).toHaveLength(1);
    expect(createdLabels[0]).toEqual(['role-ENG']);
  });
});
