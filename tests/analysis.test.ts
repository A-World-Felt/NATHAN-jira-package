import { describe, it, expect } from 'vitest';
import {
  overdueTasks, upcomingTasks, inProgressTasks, blockedTasks, tasksByPerson,
  type AnalysisTask,
} from '../src/analysis.js';

function task(over: Partial<AnalysisTask>): AnalysisTask {
  return {
    key: 'X-1', id: 'X-1', title: 'T', project: 'DEV', block: 'B',
    status: 'À Faire', statusCategory: 'todo', assignee: null,
    start: null, due: null, dependsOn: [], ...over,
  };
}

const TODAY = '2026-07-22';

describe('overdueTasks', () => {
  it('inclut les tâches ouvertes dont l’échéance est passée, triées par retard décroissant', () => {
    const tasks = [
      task({ key: 'A', due: '2026-07-20' }),                        // 2 j
      task({ key: 'B', due: '2026-07-10' }),                        // 12 j
      task({ key: 'C', due: '2026-07-25' }),                        // futur → exclu
      task({ key: 'D', due: '2026-07-01', statusCategory: 'done' }),// terminé → exclu
      task({ key: 'E', due: null }),                                // sans échéance → exclu
    ];
    const r = overdueTasks(tasks, TODAY);
    expect(r.map((t) => t.key)).toEqual(['B', 'A']);
    expect(r[0].daysLate).toBe(12);
    expect(r[1].daysLate).toBe(2);
  });
});

describe('upcomingTasks', () => {
  it('inclut les échéances dans [today, today+days], triées par échéance', () => {
    const tasks = [
      task({ key: 'A', due: '2026-07-25' }),
      task({ key: 'B', due: '2026-07-23' }),
      task({ key: 'C', due: '2026-08-30' }),                        // hors horizon
      task({ key: 'D', due: '2026-07-10' }),                        // passé
    ];
    expect(upcomingTasks(tasks, TODAY, 14).map((t) => t.key)).toEqual(['B', 'A']);
  });
});

describe('inProgressTasks', () => {
  it('ne garde que les tâches en cours', () => {
    const tasks = [task({ key: 'A', statusCategory: 'in_progress' }), task({ key: 'B' })];
    expect(inProgressTasks(tasks).map((t) => t.key)).toEqual(['A']);
  });
});

describe('blockedTasks', () => {
  it('inclut statut bloqué OU dépendance non terminée, exclut les fermées', () => {
    const tasks = [
      task({ key: 'A', statusCategory: 'blocked' }),
      task({ key: 'B', dependsOn: ['Z'] }),                         // Z absent → non terminé
      task({ key: 'C', dependsOn: ['D'] }),
      task({ key: 'D', statusCategory: 'done' }),                   // dépendance terminée
    ];
    expect(blockedTasks(tasks).map((t) => t.key).sort()).toEqual(['A', 'B']);
  });
});

describe('tasksByPerson', () => {
  it('correspondance partielle insensible à la casse, tâches ouvertes', () => {
    const tasks = [
      task({ key: 'A', assignee: 'Mathieu Nicol' }),
      task({ key: 'B', assignee: 'mathieu autre' }),
      task({ key: 'C', assignee: 'Nathan', statusCategory: 'done' }),
    ];
    expect(tasksByPerson(tasks, 'mathieu').map((t) => t.key).sort()).toEqual(['A', 'B']);
  });
});
