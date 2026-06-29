import { describe, it, expect } from 'vitest';
import { regenerate, renderRow } from '../src/taches-writer.js';
import type { Task } from '../src/types.js';

function mk(p: Partial<Task> & { id: string }): Task {
  return { jiraKey: 'NATHAN-1', title: p.id, role: 'ENG', block: 'Bloc démo',
    estimateHours: null, start: null, due: null, session: null, dependsOn: [],
    status: 'À Faire', statusCategory: 'todo', notes: '', url: null, ...p };
}

const MD = `## Bloc démo

Prose intacte.

| ID | Tâche | Rôle | Est. | Période | Début | Fin | Dépend de | Statut | Notes |
|----|-------|------|------|---------|-------|-----|-----------|--------|-------|
| A-01 | ancien titre | ENG | 1h | S6 | 2026-01-01 | 2026-01-02 | — | [ ] | vieux |
`;

describe('renderRow', () => {
  it('rend une tâche en cours', () => {
    const row = renderRow(mk({ id: 'A-01', title: 'X', estimateHours: 12, start: '2026-06-29',
      due: '2026-07-10', session: 'S6', status: 'En cours', statusCategory: 'in_progress' }));
    expect(row).toBe('| A-01 | X | ENG | 12h | S6 | 2026-06-29 | 2026-07-10 | — | [~] | |');
  });
  it("barre le titre d'une tâche annulée", () => {
    const row = renderRow(mk({ id: 'A-02', title: 'Z', statusCategory: 'cancelled' }));
    expect(row).toContain('~~Z~~');
    expect(row.endsWith('[x] | |')).toBe(true);
  });
});

describe('regenerate', () => {
  it('rafraîchit la ligne existante et préserve la prose', () => {
    const out = regenerate(MD, [mk({ id: 'A-01', title: 'nouveau', estimateHours: 5,
      start: '2026-06-29', due: '2026-07-10', session: 'S6', status: 'Terminé(e)', statusCategory: 'done' })]);
    expect(out).toContain('Prose intacte.');
    expect(out).toContain('| A-01 | nouveau | ENG | 5h | S6 | 2026-06-29 | 2026-07-10 | — | [x] | |');
    expect(out).not.toContain('ancien titre');
  });
  it('est idempotent', () => {
    const tasks = [mk({ id: 'A-01', title: 'nouveau', status: 'En cours', statusCategory: 'in_progress' })];
    const once = regenerate(MD, tasks);
    expect(regenerate(once, tasks)).toBe(once);
  });
  it('ajoute une section pour les tâches inconnues des tableaux', () => {
    const out = regenerate(MD, [mk({ id: 'NEW-9', title: 'Nouvelle' })]);
    expect(out).toContain('## Tâches ajoutées dans JIRA (non classées)');
    expect(out).toContain('| NEW-9 | Nouvelle |');
    expect(out).toContain('| A-01 | ancien titre'); // ligne A-01 laissée intacte (pas dans JIRA)
  });
});
