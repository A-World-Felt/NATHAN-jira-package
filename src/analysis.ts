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
