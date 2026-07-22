import { describe, it, expect } from 'vitest';
import {
  PlanStore, collectRefs, computeFingerprint, applyGuarded,
  type GuardDeps,
} from '../src/mcp/guard.js';
import type { ChangeSet } from '../src/taches-apply.js';
import type { RawIssue } from '../src/snapshot.js';

function issue(over: Partial<RawIssue>): RawIssue {
  return {
    key: 'DEV-1', project: 'DEV', issuetype: 'Task', summary: 'S', description: null,
    status: 'À Faire', assignee: null, parentKey: null, labels: [], start: null, due: null,
    estimateHours: null, priority: null, links: [], ...over,
  };
}

// Horloge contrôlable pour les tests de TTL.
function fakeClock(start = 1000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('collectRefs', () => {
  it('rassemble les clés existantes touchées (update, delete, deps existants)', () => {
    const cs: ChangeSet = {
      update: [{ ref: 'DEV-2', statut: 'En cours', dependsOn: [{ ref: 'DEV-9', type: 'FS', existingKey: true }] }],
      delete: [{ ref: 'DEV-3' }],
      create: [{ idV2: 'n1', nom: 'X', projet: 'DEV', epic: 'DEV-100', statutInitial: 'À Faire',
        dependsOn: [{ ref: 'n0', type: 'FS' }, { ref: 'DEV-5', type: 'SS', existingKey: true }] }],
    };
    expect(collectRefs(cs).sort()).toEqual(['DEV-2', 'DEV-3', 'DEV-5', 'DEV-9']);
  });
});

describe('computeFingerprint', () => {
  it('stable quel que soit l’ordre des issues et des refs', () => {
    const issues = [issue({ key: 'DEV-2', status: 'En cours' }), issue({ key: 'DEV-1', summary: 'A' })];
    const a = computeFingerprint(issues, ['DEV-1', 'DEV-2']);
    const b = computeFingerprint([...issues].reverse(), ['DEV-2', 'DEV-1']);
    expect(a).toBe(b);
  });
  it('change quand un champ mutable change', () => {
    const before = computeFingerprint([issue({ key: 'DEV-1', status: 'À Faire' })], ['DEV-1']);
    const after = computeFingerprint([issue({ key: 'DEV-1', status: 'Terminé(e)' })], ['DEV-1']);
    expect(after).not.toBe(before);
  });
  it('marque ABSENT une ref disparue', () => {
    expect(computeFingerprint([], ['DEV-1'])).toContain('DEV-1:ABSENT');
  });
});

describe('PlanStore', () => {
  it('put → take rend le plan une seule fois (consommation)', () => {
    const clk = fakeClock();
    const store = new PlanStore(clk.now, 10_000);
    const id = store.put({ changeset: {}, refs: [], fingerprint: '', preview: 'p' });
    expect(store.take(id)?.preview).toBe('p');
    expect(store.take(id)).toBeNull(); // déjà consommé
  });
  it('take → null après expiration (TTL)', () => {
    const clk = fakeClock();
    const store = new PlanStore(clk.now, 10_000);
    const id = store.put({ changeset: {}, refs: [], fingerprint: '', preview: 'p' });
    clk.advance(10_001);
    expect(store.take(id)).toBeNull();
  });
  it('take → null pour un id inconnu', () => {
    const store = new PlanStore(fakeClock().now, 10_000);
    expect(store.take('plan-999')).toBeNull();
  });
});

// --- applyGuarded : orchestration + invariants de sûreté ---

function makeDeps(over: Partial<GuardDeps> & { issues?: RawIssue[]; calls?: string[] } = {}): GuardDeps {
  const calls = over.calls ?? [];
  const issues = over.issues ?? [issue({ key: 'DEV-1' })];
  return {
    store: over.store ?? new PlanStore(fakeClock().now, 10_000),
    fetchSnapshot: over.fetchSnapshot ?? (async () => { calls.push('fetch'); return { issues }; }),
    writeSnapshot: over.writeSnapshot ?? (async () => { calls.push('snapshot'); return '/snap/path.json'; }),
    indexSnapshot: over.indexSnapshot ?? ((() => { calls.push('index'); return {} as any; })),
    applyChanges: over.applyChanges ?? (async () => { calls.push('apply'); return {
      created: [], subtasks: [], updated: ['DEV-1'], links: [], deleted: [], errors: [],
    }; }),
  };
}

describe('applyGuarded', () => {
  it('planId inconnu/expiré → refus, aucune mutation', async () => {
    const calls: string[] = [];
    const deps = makeDeps({ calls });
    const out = await applyGuarded(deps, 'plan-inexistant');
    expect(out).toEqual({ ok: false, reason: 'unknown_or_expired' });
    expect(calls).not.toContain('apply');
    expect(calls).not.toContain('snapshot');
  });

  it('dérive détectée → refus AVANT snapshot et apply', async () => {
    const calls: string[] = [];
    const store = new PlanStore(fakeClock().now, 10_000);
    // proposé sur un état où DEV-1 est « À Faire »
    const id = store.put({ changeset: { update: [{ ref: 'DEV-1', statut: 'En cours' }] },
      refs: ['DEV-1'], fingerprint: computeFingerprint([issue({ key: 'DEV-1', status: 'À Faire' })], ['DEV-1']),
      preview: 'p' });
    // mais l'état live a changé (quelqu'un a terminé DEV-1)
    const deps = makeDeps({ store, calls, issues: [issue({ key: 'DEV-1', status: 'Terminé(e)' })] });
    const out = await applyGuarded(deps, id);
    expect(out.ok).toBe(false);
    expect((out as any).reason).toBe('drift');
    expect(calls).toContain('fetch');
    expect(calls).not.toContain('snapshot');
    expect(calls).not.toContain('apply');
  });

  it('chemin heureux → snapshot AVANT apply, renvoie chemin + résultat', async () => {
    const calls: string[] = [];
    const store = new PlanStore(fakeClock().now, 10_000);
    const fp = computeFingerprint([issue({ key: 'DEV-1', status: 'À Faire' })], ['DEV-1']);
    const id = store.put({ changeset: { update: [{ ref: 'DEV-1', statut: 'En cours' }] },
      refs: ['DEV-1'], fingerprint: fp, preview: 'p' });
    const deps = makeDeps({ store, calls, issues: [issue({ key: 'DEV-1', status: 'À Faire' })] });
    const out = await applyGuarded(deps, id);
    expect(out.ok).toBe(true);
    expect((out as any).snapshotPath).toBe('/snap/path.json');
    expect((out as any).result.updated).toEqual(['DEV-1']);
    // INVARIANT : le snapshot préventif est pris avant toute mutation
    expect(calls.indexOf('snapshot')).toBeLessThan(calls.indexOf('apply'));
  });
});
