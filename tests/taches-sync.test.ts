// tests/taches-sync.test.ts
import { describe, it, expect } from 'vitest';
import { refreshTaches, nidOf } from '../src/taches-sync.js';
import type { RawIssue } from '../src/snapshot.js';

function issue(p: Partial<RawIssue> & { key: string }): RawIssue {
  return {
    key: p.key, project: p.project ?? 'LIVS', issuetype: p.issuetype ?? 'Tâche',
    summary: p.summary ?? '', description: null, status: p.status ?? 'À faire',
    assignee: null, parentKey: p.parentKey ?? null, labels: p.labels ?? [],
    start: p.start ?? null, due: p.due ?? null, estimateHours: null,
    priority: null, links: p.links ?? [],
  };
}

const HEADER = '| ID | Tâche (nom) | Bloc (Epic) | Projet | Colonne | Rôle | Est. | Session | Début | Fin | Dépend de (+type) | Statut | Notes |';
const SEP    = '|---|---|---|---|---|---|---|---|---|---|---|---|---|';

const MD = [
  '# Plan', '',
  '## Légende',
  '| Champ | Sens |', '|---|---|', '| ID | Identifiant |', '',
  '## Epic LIVS-MIP', '',
  HEADER, SEP,
  '| MIP-01 | Description | LIVS-MIP | LIVS | En cours | ÉQUIPE | 12h | S6 | 2026-06-08 | 2026-06-11 [fixe] | — | [~] | note |',
  '| BOI-01 | Coque | DC-BOI | DC | Boîtier | ELEC | 40h | S6 | 2026-06-22 | 2026-07-17 | — | [ ] | |',
  '| ZED-9 | Inconnue | X | LIVS | À faire | ÉQUIPE | 2h | S6 | 2026-06-01 | 2026-06-02 | — | [ ] | |',
  '', '## Jalons',
  '| Jalon | Date | Débloque |', '|---|---|---|', '| MIP-01 | 2026-06-18 | tout |', '',
].join('\n');

const ISSUES: RawIssue[] = [
  issue({ key: 'LIVS-82', project: 'LIVS', status: 'Terminé(e)', labels: ['nid-MIP-01'], start: '2026-06-09', due: '2026-06-12' }),
  issue({ key: 'DC-5', project: 'DC', status: 'PCB - À faire', labels: ['nid-BOI-01'], start: '2026-06-22', due: '2026-07-17' }),
  issue({ key: 'LIVS-99', project: 'LIVS', status: 'À faire', labels: ['nid-EXTRA-2'] }),
  issue({ key: 'LIVS-75', project: 'LIVS', issuetype: 'Epic', labels: [] }),
];

describe('nidOf', () => {
  it('extrait le nid depuis les labels', () => {
    expect(nidOf({ labels: ['x', 'nid-MIP-01'] })).toBe('MIP-01');
    expect(nidOf({ labels: [] })).toBeNull();
  });
});

describe('refreshTaches', () => {
  const res = refreshTaches(MD, ISSUES);
  const lines = res.markdown.split('\n');
  const row = (id: string) => lines.find((l) => l.trim().startsWith(`| ${id} `))!;

  it('met le glyphe [x] pour Terminé(e)', () => {
    expect(row('MIP-01')).toContain('| [x] |');
  });

  it('met la Colonne LIVS = statut JIRA', () => {
    expect(row('MIP-01')).toContain('| Terminé(e) |');
    expect(row('MIP-01')).not.toContain('| En cours |');
  });

  it('remplace les dates JIRA en gardant l\'annotation [fixe]', () => {
    expect(row('MIP-01')).toContain('2026-06-09');
    expect(row('MIP-01')).toContain('2026-06-12 [fixe]');
  });

  it('préserve Rôle et Est. (propriété du plan)', () => {
    const r = row('MIP-01');
    expect(r).toContain('| ÉQUIPE |');
    expect(r).toContain('| 12h |');
  });

  it('ne change pas la Colonne d\'un DC et signale le mismatch', () => {
    expect(row('BOI-01')).toContain('| Boîtier |');
    expect(res.stats.columnMismatches.join(' ')).toContain('BOI-01');
    expect(res.stats.columnMismatches.join(' ')).toContain('PCB');
  });

  it('laisse intactes les lignes sans correspondance JIRA', () => {
    expect(row('ZED-9')).toContain('| À faire |');
    expect(res.stats.planRowsUnmatched).toContain('ZED-9');
  });

  it('signale les issues JIRA absentes du plan', () => {
    expect(res.stats.jiraNotInPlan).toContain('EXTRA-2');
  });

  it('ne touche pas la table Jalons ni la légende', () => {
    expect(res.markdown).toContain('| MIP-01 | 2026-06-18 | tout |');
    expect(res.markdown).toContain('| ID | Identifiant |');
  });
});
