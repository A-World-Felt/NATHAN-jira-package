// src/analysis.ts — Analyse PURE et NEUTRE de l'état projet (aucune I/O, aucune convention).
// Porté depuis gestion/src/queries.ts. Alimente le tool MCP `jira_view`.
import type { StatusCategory } from './types.js';

export interface AnalysisTask {
  key: string;
  id: string;
  title: string;
  project: string;
  block: string;
  status: string;
  statusCategory: StatusCategory;
  assignee: string | null;
  start: string | null;   // YYYY-MM-DD
  due: string | null;     // YYYY-MM-DD
  dependsOn: string[];    // clés des prédécesseurs (bloqueurs)
}

export interface TaskBrief {
  key: string; id: string; title: string; project: string; block: string;
  status: string; assignee: string | null; start: string | null; due: string | null;
}
export interface OverdueBrief extends TaskBrief { daysLate: number; }

function brief(t: AnalysisTask): TaskBrief {
  return { key: t.key, id: t.id, title: t.title, project: t.project, block: t.block,
    status: t.status, assignee: t.assignee, start: t.start, due: t.due };
}

// « active » = non annulée ; « open » = non terminée ET non annulée (travail restant).
const isActive = (t: AnalysisTask): boolean => t.statusCategory !== 'cancelled';
const isOpen = (t: AnalysisTask): boolean => t.statusCategory !== 'done' && t.statusCategory !== 'cancelled';
const addDays = (iso: string, n: number): string => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Tâches en retard : échéance passée, non terminées/annulées. Triées par retard décroissant. */
export function overdueTasks(tasks: AnalysisTask[], today: string): OverdueBrief[] {
  return tasks
    .filter((t) => isOpen(t) && t.due != null && t.due < today)
    .map((t) => ({ ...brief(t), daysLate: daysBetween(t.due!, today) }))
    .sort((a, b) => b.daysLate - a.daysLate);
}

/** Prochaines tâches : échéance dans [today, today+days], non terminées. Triées par échéance. */
export function upcomingTasks(tasks: AnalysisTask[], today: string, days = 14): TaskBrief[] {
  const horizon = addDays(today, days);
  return tasks
    .filter((t) => isOpen(t) && t.due != null && t.due >= today && t.due <= horizon)
    .sort((a, b) => (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : 0))
    .map(brief);
}

/** Tâches en cours. */
export function inProgressTasks(tasks: AnalysisTask[]): TaskBrief[] {
  return tasks.filter((t) => t.statusCategory === 'in_progress').map(brief);
}

/** Tâches bloquées : statut « bloqué », ou ≥1 dépendance non terminée. */
export function blockedTasks(tasks: AnalysisTask[]): TaskBrief[] {
  const doneKeys = new Set(tasks.filter((t) => t.statusCategory === 'done').map((t) => t.key));
  return tasks
    .filter((t) => isOpen(t) && (t.statusCategory === 'blocked' || t.dependsOn.some((d) => !doneKeys.has(d))))
    .map(brief);
}

/** Tâches d'une personne (correspondance partielle, insensible à la casse). */
export function tasksByPerson(tasks: AnalysisTask[], name: string): TaskBrief[] {
  const n = name.trim().toLowerCase();
  return tasks.filter((t) => isOpen(t) && (t.assignee ?? '').toLowerCase().includes(n)).map(brief);
}

export interface ProjectMetrics { project: string; total: number; active: number; done: number; pct: number; overdue: number; }
export interface Metrics {
  generatedAt: string;
  total: number; active: number; open: number; done: number; pctDone: number;
  loggedHours: number;
  overdue: number; upcoming14d: number; inProgress: number; blocked: number; unassigned: number;
  byProject: ProjectMetrics[];
}
export interface MetricsInput {
  tasks: AnalysisTask[];
  worklogs: ReadonlyArray<{ hours: number }>;
  generatedAt: string;
}

/** Métriques utiles agrégées (lightweight, sans chemin critique). */
export function metrics(input: MetricsInput, today: string): Metrics {
  const { tasks, worklogs, generatedAt } = input;
  const active = tasks.filter(isActive);
  const done = tasks.filter((t) => t.statusCategory === 'done');
  const loggedHours = Math.round(worklogs.reduce((s, w) => s + w.hours, 0) * 10) / 10;
  const projects = [...new Set(tasks.map((t) => t.project))].sort();
  const byProject: ProjectMetrics[] = projects.map((p) => {
    const ts = tasks.filter((t) => t.project === p);
    const a = ts.filter(isActive);
    const d = ts.filter((t) => t.statusCategory === 'done');
    const od = ts.filter((t) => isOpen(t) && t.due != null && t.due < today);
    return { project: p, total: ts.length, active: a.length, done: d.length,
      pct: a.length ? Math.round((d.length / a.length) * 100) : 0, overdue: od.length };
  });
  return {
    generatedAt,
    total: tasks.length, active: active.length, open: tasks.filter(isOpen).length, done: done.length,
    pctDone: active.length ? Math.round((done.length / active.length) * 100) : 0,
    loggedHours,
    overdue: overdueTasks(tasks, today).length,
    upcoming14d: upcomingTasks(tasks, today, 14).length,
    inProgress: inProgressTasks(tasks).length,
    blocked: blockedTasks(tasks).length,
    unassigned: tasks.filter((t) => isOpen(t) && !t.assignee).length,
    byProject,
  };
}
