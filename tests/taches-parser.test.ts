import { describe, it, expect } from 'vitest';
import { parseTasks } from '../src/taches-parser.js';

const MD = `# Titre

## Bloc démo

Du texte de prose.

| ID | Tâche | Rôle | Est. | Période | Début | Fin | Dépend de | Statut | Notes |
|----|-------|------|------|---------|-------|-----|-----------|--------|-------|
| A-01 | Faire la chose | ENG | 12h | S6 | 2026-06-29 | 2026-07-10 | — | [x] | une note |
| A-02 | ~~Annulée~~ | GESTION | — | — | — | — | A-01 | [x] | abandonnée |
| A-03 | À venir | AUD | 8h | S6 | 2026-07-13 | 2026-07-17 | A-01,A-02 | [ ] | — |

| Autre | Table | Non-tâche |
|-------|-------|-----------|
| x | y | z |
`;

describe('parseTasks', () => {
  it('extrait les lignes de tâches et ignore les autres tables', () => {
    const tasks = parseTasks(MD);
    expect(tasks.map((t) => t.id)).toEqual(['A-01', 'A-02', 'A-03']);
  });
  it('parse les champs typés', () => {
    const a1 = parseTasks(MD).find((t) => t.id === 'A-01')!;
    expect(a1).toMatchObject({
      title: 'Faire la chose', role: 'ENG', estimateHours: 12,
      start: '2026-06-29', due: '2026-07-10', session: 'S6',
      statusCategory: 'done', block: 'Bloc démo', notes: 'une note', dependsOn: [],
    });
  });
  it('détecte une tâche annulée (titre barré) et les dépendances multiples', () => {
    const tasks = parseTasks(MD);
    expect(tasks.find((t) => t.id === 'A-02')!.statusCategory).toBe('cancelled');
    expect(tasks.find((t) => t.id === 'A-02')!.title).toBe('Annulée');
    expect(tasks.find((t) => t.id === 'A-03')!.dependsOn).toEqual(['A-01', 'A-02']);
  });
});
