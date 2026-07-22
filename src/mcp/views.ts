// src/mcp/views.ts — Vues de lecture du serveur MCP : snapshot brut → tâches neutres → analyse.
//
// Mapping FIDÈLE à gestion/pm-data.ts : dependsOn = liens « Blocks » inward, block = résumé du
// parent, statusCategory via deriveCategory. Puis délègue aux fonctions PURES de analysis.ts.
import type { RawIssue } from '../snapshot.js';
import { deriveCategory } from '../jira-conventions.js';
import {
  overdueTasks, upcomingTasks, inProgressTasks, blockedTasks, tasksByPerson, metrics,
  type AnalysisTask,
} from '../analysis.js';

/** Convertit un snapshot d'issues en tâches neutres analysables. Exclut les Epics. */
export function snapshotToTasks(issues: RawIssue[]): AnalysisTask[] {
  const summaryByKey = new Map(issues.map((i) => [i.key, i.summary]));
  return issues
    .filter((i) => i.issuetype !== 'Epic')
    .map((i) => ({
      key: i.key,
      id: i.key,
      title: i.summary,
      project: i.project,
      block: i.parentKey ? (summaryByKey.get(i.parentKey) ?? i.parentKey) : i.summary,
      status: i.status,
      statusCategory: deriveCategory(i.status, i.labels ?? []),
      assignee: i.assignee,
      start: i.start,
      due: i.due,
      dependsOn: (i.links ?? []).filter((l) => l.type === 'Blocks' && l.inwardKey).map((l) => l.inwardKey!),
    }));
}

export type ViewName = 'overdue' | 'upcoming' | 'inprogress' | 'blocked' | 'person' | 'metrics';

export interface ViewOpts {
  today: string;
  days?: number;                                   // pour upcoming (défaut 14)
  person?: string;                                 // pour person
  worklogs?: ReadonlyArray<{ hours: number }>;     // pour metrics (défaut [])
  generatedAt?: string;                            // pour metrics
}

/** Exécute une vue nommée sur un snapshot. Lève une erreur explicite pour une vue inconnue. */
export function runView(view: ViewName, issues: RawIssue[], opts: ViewOpts): any {
  const tasks = snapshotToTasks(issues);
  switch (view) {
    case 'overdue': return overdueTasks(tasks, opts.today);
    case 'upcoming': return upcomingTasks(tasks, opts.today, opts.days ?? 14);
    case 'inprogress': return inProgressTasks(tasks);
    case 'blocked': return blockedTasks(tasks);
    case 'person': return tasksByPerson(tasks, opts.person ?? '');
    case 'metrics': return metrics(
      { tasks, worklogs: opts.worklogs ?? [], generatedAt: opts.generatedAt ?? opts.today },
      opts.today,
    );
    default: throw new Error(`vue inconnue : ${view}`);
  }
}
