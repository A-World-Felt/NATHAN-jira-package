// src/mcp/verbs.ts — Verbes de gestion « user-friendly » → ChangeSet + aperçu.
//
// Fonctions PURES : chaque verbe construit un ChangeSet (jamais appliqué ici) et un aperçu
// humain. La plomberie (projet, epic, dates, labels) est explicite → aucune convention
// forcée. Si un profil est fourni, il ENRICHIT (labels de bloc, lint du résumé) sans jamais
// bloquer : l'agent reste maître de la proposition.
import type { ChangeSet } from '../taches-apply.js';
import type { DepType } from '../jira-write.js';
import type { ConventionProfile } from '../profile.js';

export interface VerbResult { changeset: ChangeSet; preview: string; }

/** idV2 déterministe (testable) dérivé du résumé. */
function slugId(summary: string): string {
  const s = summary.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return `new-${s || 'tache'}`;
}

export interface AddTaskInput {
  project: string;
  summary: string;
  epicKey: string;
  start?: string | null;
  due?: string | null;
  labels?: string[];
  assignee?: string | null;
  estimateHours?: number | null;
  bloc?: string;             // optionnel : composante NATHAN → label via profile.mapLabels
}

export function addTask(input: AddTaskInput, profile?: ConventionProfile): VerbResult {
  const labels = [...(input.labels ?? [])];
  if (input.bloc && profile?.mapLabels) {
    for (const l of profile.mapLabels(input.bloc)) if (!labels.includes(l)) labels.push(l);
  }
  const notes: string[] = [];
  if (profile?.lintSummary) {
    const lint = profile.lintSummary(input.summary);
    if (!lint.ok) notes.push(`⚠ résumé non conforme (${lint.violations})${lint.suggestion ? ` — suggéré : « ${lint.suggestion} »` : ''}`);
  }
  const changeset: ChangeSet = {
    create: [{
      idV2: slugId(input.summary),
      nom: input.summary,
      projet: input.project,
      epic: input.epicKey,
      statutInitial: 'À Faire',
      debut: input.start ?? null,
      fin: input.due ?? null,
      labels,
      assignee: input.assignee,
      estimateHours: input.estimateHours,
    }],
  };
  const bits = [
    `Créer « ${input.summary} » dans ${input.project} (epic ${input.epicKey})`,
    input.start || input.due ? `  dates : ${input.start ?? '—'} → ${input.due ?? '—'}` : null,
    labels.length ? `  labels : ${labels.join(', ')}` : null,
    input.assignee ? `  assigné : ${input.assignee}` : null,
    input.estimateHours != null ? `  estimé : ${input.estimateHours} h` : null,
    ...notes.map((n) => `  ${n}`),
  ].filter(Boolean);
  return { changeset, preview: bits.join('\n') };
}

export function reschedule(input: { key: string; start?: string; due?: string }): VerbResult {
  const changeset: ChangeSet = { update: [{ ref: input.key, debut: input.start, fin: input.due }] };
  return { changeset, preview: `Reprogrammer ${input.key} : ${input.start ?? '—'} → ${input.due ?? '—'}` };
}

export function assign(input: { key: string; assignee: string | null }): VerbResult {
  const changeset: ChangeSet = { update: [{ ref: input.key, assignee: input.assignee }] };
  return { changeset, preview: input.assignee ? `Assigner ${input.key} à ${input.assignee}` : `Désassigner ${input.key}` };
}

export function setEstimate(input: { key: string; hours: number | null }): VerbResult {
  const changeset: ChangeSet = { update: [{ ref: input.key, estimateHours: input.hours }] };
  return { changeset, preview: input.hours != null ? `Estimer ${input.key} à ${input.hours} h` : `Effacer l'estimation de ${input.key}` };
}

export function setStatus(input: { key: string; statusName: string }): VerbResult {
  const changeset: ChangeSet = { update: [{ ref: input.key, statut: input.statusName }] };
  return { changeset, preview: `Passer ${input.key} au statut « ${input.statusName} »` };
}

export function link(input: { prereqKey: string; taskKey: string; type: DepType }): VerbResult {
  const changeset: ChangeSet = {
    update: [{ ref: input.taskKey, dependsOn: [{ ref: input.prereqKey, type: input.type, existingKey: true }] }],
  };
  const kind = input.type === 'FS' ? 'bloque (FS)' : 'liée (SS)';
  return { changeset, preview: `Dépendance : ${input.prereqKey} ${kind} → ${input.taskKey}` };
}

export function deleteTask(input: { key: string; reason?: string }): VerbResult {
  const changeset: ChangeSet = { delete: [{ ref: input.key, raison: input.reason }] };
  return { changeset, preview: `Supprimer ${input.key}${input.reason ? ` (${input.reason})` : ''}` };
}

export interface SubtaskInput { summary: string; assignee?: string | null; estimateHours?: number | null; start?: string | null; due?: string | null; }

export function addSubtasks(input: { parentKey: string; subtasks: SubtaskInput[] }): VerbResult {
  const changeset: ChangeSet = {
    update: [{
      ref: input.parentKey,
      subtasks: input.subtasks.map((s, i) => ({
        idV2: `sub-${input.parentKey}-${i + 1}`,
        nom: s.summary,
        debut: s.start ?? null,
        fin: s.due ?? null,
        assignee: s.assignee,
        estimateHours: s.estimateHours,
      })),
    }],
  };
  return { changeset, preview: `Ajouter ${input.subtasks.length} sous-tâche(s) à ${input.parentKey} :\n` + input.subtasks.map((s) => `  • ${s.summary}`).join('\n') };
}
