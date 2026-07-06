// tests/taches-sync.test.ts
import { describe, it, expect } from 'vitest';
import * as sync from '../src/taches-sync.js';
import { refreshTaches } from '../src/taches-sync.js';
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
  '| LIVS-82 | Description | LIVS-MIP | LIVS | En cours | ÉQUIPE | 12h | S6 | 2026-06-08 | 2026-06-11 [fixe] | — | [~] | note |',
  '| DC-5 | Coque | DC-BOI | DC | Boîtier | ELEC | 40h | S6 | 2026-06-22 | 2026-07-17 | — | [ ] | |',
  '| ZED-9 | Inconnue | X | LIVS | À faire | ÉQUIPE | 2h | S6 | 2026-06-01 | 2026-06-02 | — | [ ] | |',
  '', '## Jalons',
  '| Jalon | Date | Débloque |', '|---|---|---|', '| LIVS-82 | 2026-06-18 | tout |', '',
].join('\n');

const ISSUES: RawIssue[] = [
  issue({ key: 'LIVS-82', project: 'LIVS', status: 'Terminé(e)', start: '2026-06-09', due: '2026-06-12' }),
  issue({ key: 'DC-5', project: 'DC', status: 'PCB - À faire', start: '2026-06-22', due: '2026-07-17' }),
  issue({ key: 'LIVS-99', project: 'LIVS', status: 'À faire' }), // hors plan, issuetype Tâche -> doit apparaître
  issue({ key: 'LIVS-75', project: 'LIVS', issuetype: 'Epic' }), // hors plan, Epic -> ne doit PAS apparaître
];

describe('taches-sync : pas de mécanisme nid', () => {
  it('n\'exporte plus nidOf', () => {
    expect('nidOf' in sync).toBe(false);
  });
});

describe('refreshTaches', () => {
  const res = refreshTaches(MD, ISSUES);
  const lines = res.markdown.split('\n');
  const row = (id: string) => lines.find((l) => l.trim().startsWith(`| ${id} `))!;

  it('matche par clé JIRA (colonne ID) et met le glyphe [x] pour Terminé(e)', () => {
    expect(row('LIVS-82')).toContain('| [x] |');
  });

  it('met la Colonne LIVS = statut JIRA', () => {
    expect(row('LIVS-82')).toContain('| Terminé(e) |');
    expect(row('LIVS-82')).not.toContain('| En cours |');
  });

  it('remplace les dates JIRA en gardant l\'annotation [fixe]', () => {
    expect(row('LIVS-82')).toContain('2026-06-09');
    expect(row('LIVS-82')).toContain('2026-06-12 [fixe]');
  });

  it('préserve Rôle et Est. (propriété du plan)', () => {
    const r = row('LIVS-82');
    expect(r).toContain('| ÉQUIPE |');
    expect(r).toContain('| 12h |');
  });

  it('ne change pas la Colonne d\'un DC et signale le mismatch', () => {
    expect(row('DC-5')).toContain('| Boîtier |');
    expect(res.stats.columnMismatches.join(' ')).toContain('DC-5');
    expect(res.stats.columnMismatches.join(' ')).toContain('PCB');
  });

  it('laisse intactes les lignes sans correspondance JIRA', () => {
    expect(row('ZED-9')).toContain('| À faire |');
    expect(res.stats.planRowsUnmatched).toContain('ZED-9');
  });

  it('signale les issues JIRA (Tâche/Sous-tâche) absentes du plan, mais filtre les Epic', () => {
    expect(res.stats.jiraNotInPlan).toContain('LIVS-99');
    expect(res.stats.jiraNotInPlan).not.toContain('LIVS-75');
  });

  it('ne touche pas la table Jalons ni la légende', () => {
    expect(res.markdown).toContain('| LIVS-82 | 2026-06-18 | tout |');
    expect(res.markdown).toContain('| ID | Identifiant |');
  });
});
