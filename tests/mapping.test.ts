import { describe, it, expect } from 'vitest';
import { sessionFromDate, statusInfo, computeOrder, findOrphanDeps, hasCycle } from '../src/mapping.js';
import type { Task } from '../src/types.js';

describe('sessionFromDate', () => {
  it('mappe une date dans S6', () => {
    expect(sessionFromDate('2026-06-29')).toBe('S6');
  });
  it('mappe les bornes incluses', () => {
    expect(sessionFromDate('2026-05-04')).toBe('S6');
    expect(sessionFromDate('2027-04-30')).toBe('S7');
  });
  it('renvoie null hors de toute session', () => {
    expect(sessionFromDate('2026-08-20')).toBeNull();
  });
  it('renvoie null pour une date absente', () => {
    expect(sessionFromDate(null)).toBeNull();
  });
});

describe('statusInfo', () => {
  it('mappe les 5 statuts réels', () => {
    expect(statusInfo('À Faire')).toEqual({ category: 'todo', glyph: '[ ]' });
    expect(statusInfo('En cours')).toEqual({ category: 'in_progress', glyph: '[~]' });
    expect(statusInfo('Révision')).toEqual({ category: 'in_progress', glyph: '[r]' });
    expect(statusInfo('Bloqué')).toEqual({ category: 'in_progress', glyph: '[!]' });
    expect(statusInfo('Terminé(e)')).toEqual({ category: 'done', glyph: '[x]' });
  });
  it('tolère les espaces et un statut inconnu (-> todo)', () => {
    expect(statusInfo('  En cours ')).toEqual({ category: 'in_progress', glyph: '[~]' });
    expect(statusInfo('Truc')).toEqual({ category: 'todo', glyph: '[ ]' });
  });
});

function t(id: string, start: string | null, dependsOn: string[] = []): Task {
  return { id, jiraKey: null, title: id, role: '', block: '', estimateHours: null,
    start, due: null, session: null, dependsOn, status: '', statusCategory: 'todo',
    notes: '', url: null };
}

describe('computeOrder', () => {
  it('respecte les dépendances avant les dates', () => {
    const order = computeOrder([t('B', '2026-01-01', ['A']), t('A', '2026-02-01')]);
    expect(order.map(x => x.id)).toEqual(['A', 'B']);
  });
  it('départage les tâches indépendantes par date puis id', () => {
    const order = computeOrder([t('Y', '2026-03-01'), t('X', '2026-01-01'), t('Z', '2026-01-01')]);
    expect(order.map(x => x.id)).toEqual(['X', 'Z', 'Y']);
  });
  it('ignore une dépendance orpheline', () => {
    const order = computeOrder([t('A', '2026-01-01', ['INCONNU'])]);
    expect(order.map(x => x.id)).toEqual(['A']);
  });
  it('retombe sur un tri par date si cycle', () => {
    const order = computeOrder([t('A', '2026-02-01', ['B']), t('B', '2026-01-01', ['A'])]);
    expect(order.map(x => x.id)).toEqual(['B', 'A']);
  });
});

describe('findOrphanDeps', () => {
  it('liste les dépendances absentes du jeu de tâches', () => {
    const res = findOrphanDeps([t('A', '2026-01-01', ['INCONNU']), t('B', '2026-01-02', ['A'])]);
    expect(res).toEqual([{ id: 'A', dep: 'INCONNU' }]);
  });
});

describe('hasCycle', () => {
  it('détecte un cycle', () => {
    expect(hasCycle([t('A', '2026-02-01', ['B']), t('B', '2026-01-01', ['A'])])).toBe(true);
  });
  it('renvoie false sans cycle', () => {
    expect(hasCycle([t('A', '2026-01-01'), t('B', '2026-01-02', ['A'])])).toBe(false);
  });
});
