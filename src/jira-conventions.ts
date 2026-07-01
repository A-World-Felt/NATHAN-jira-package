// src/jira-conventions.ts
// Fonctions de convention pure : catégorisation de statut JIRA + lint de résumé.
// Aucune I/O. Partagé par taches-sync et taches-apply.

import type { StatusCategory } from './types.js';

const DONE = new Set(['terminé(e)', 'terminé', 'done', 'fermé', 'closed', 'résolu', 'resolved']);
const CANCELLED = new Set(['annulé', 'annulée', 'cancelled', 'canceled']);

/** Déduit la catégorie de statut JIRA depuis le nom de statut et les labels d'une issue.
 *  Le nom est testé en SOUS-CHAÎNE (comme « bloqu »/« cours ») pour tolérer les statuts de
 *  workflow préfixés (ex. « Web - Terminé », « Game Engine - Terminé »). L'ordre importe :
 *  annulé avant terminé (un statut ne contient jamais les deux en pratique). */
export function deriveCategory(status: string, labels: string[]): StatusCategory {
  const s = (status || '').trim().toLowerCase();
  const nameHas = (set: Set<string>) => [...set].some((w) => s.includes(w));
  if (labels.some((l) => CANCELLED.has(l.toLowerCase())) || nameHas(CANCELLED)) return 'cancelled';
  if (nameHas(DONE)) return 'done';
  if (s.includes('bloqu') || s === 'blocked') return 'blocked';
  if (s.startsWith('révis') || s.startsWith('revis') || s === 'review') return 'review';
  if (s.includes('cours') || s === 'in progress') return 'in_progress';
  return 'todo';
}

const MARKDOWN = /\*\*|__|`/;
const DECORATION = /[◆◇■□▶►★☆✦✱]/u;

/** Renvoie le(s) motif(s) de violation (jointure), ou null si le résumé est conforme.
 *  Convention JIRA §7 : texte brut uniquement, sans markdown ni symboles décoratifs. */
export function lintSummary(summary: string): string | null {
  const reasons: string[] = [];
  if (MARKDOWN.test(summary)) reasons.push('markdown (** __ `)');
  if (DECORATION.test(summary)) reasons.push('symbole décoratif');
  if (summary !== summary.trim()) reasons.push('espaces en bord');
  if (/\s{2,}/.test(summary)) reasons.push('espaces multiples');
  return reasons.length ? reasons.join(', ') : null;
}
