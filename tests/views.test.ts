import { describe, it, expect } from 'vitest';
import { snapshotToTasks, runView } from '../src/mcp/views.js';
import type { RawIssue } from '../src/snapshot.js';

function issue(over: Partial<RawIssue>): RawIssue {
  return {
    key: 'DEV-1', project: 'DEV', issuetype: 'Task', summary: 'S', description: null,
    status: 'À Faire', assignee: null, parentKey: null, labels: [], start: null, due: null,
    estimateHours: null, priority: null, links: [], ...over,
  };
}

describe('snapshotToTasks', () => {
  it('dérive statusCategory, block (résumé du parent) et dependsOn (Blocks inward)', () => {
    const issues = [
      issue({ key: 'DEV-100', issuetype: 'Epic', summary: 'Moteur' }),
      issue({ key: 'DEV-1', summary: 'Bloc parent', status: 'En cours' }),
      issue({ key: 'DEV-2', summary: 'Enfant', parentKey: 'DEV-1', status: 'À Faire',
        links: [{ type: 'Blocks', inwardKey: 'DEV-9' }, { type: 'Relates', inwardKey: 'DEV-8' }] }),
    ];
    const tasks = snapshotToTasks(issues);
    const child = tasks.find((t) => t.key === 'DEV-2')!;
    expect(child.block).toBe('Bloc parent');            // résumé du parent
    expect(child.dependsOn).toEqual(['DEV-9']);         // seul le lien Blocks inward
    expect(child.statusCategory).toBe('todo');
    expect(tasks.find((t) => t.key === 'DEV-1')!.statusCategory).toBe('in_progress');
  });
});

describe('runView', () => {
  const today = '2026-07-22';
  const issues = [
    issue({ key: 'DEV-1', summary: 'En retard', status: 'À Faire', due: '2026-07-10' }),
    issue({ key: 'DEV-2', summary: 'En cours', status: 'En cours' }),
    issue({ key: 'DEV-3', summary: 'Bientôt', status: 'À Faire', due: '2026-07-25' }),
  ];

  it('overdue', () => {
    const r = runView('overdue', issues, { today });
    expect(r.map((t: any) => t.key)).toEqual(['DEV-1']);
  });
  it('inprogress', () => {
    expect(runView('inprogress', issues, { today }).map((t: any) => t.key)).toEqual(['DEV-2']);
  });
  it('upcoming (fenêtre par défaut)', () => {
    expect(runView('upcoming', issues, { today, days: 21 }).map((t: any) => t.key)).toEqual(['DEV-3']);
  });
  it('metrics (loggedHours=0 sans worklogs)', () => {
    const m = runView('metrics', issues, { today });
    expect(m.total).toBe(3);
    expect(m.loggedHours).toBe(0);
  });
  it('vue inconnue → throw explicite', () => {
    expect(() => runView('zzz' as any, issues, { today })).toThrow(/vue inconnue/i);
  });
});
