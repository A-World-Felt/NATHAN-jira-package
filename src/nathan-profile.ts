// src/nathan-profile.ts — Profil de conventions NATHAN (OPTIONNEL, opt-in).
//
// ⚠️ CE MODULE N'EST PAS NEUTRE. Il n'est JAMAIS réexporté depuis index.ts ni importé par le
// code du serveur MCP. Il est distribué comme SOUS-CHEMIN d'export du package
// (`@a-world-felt/nathan-jira-core/nathan-profile`) et chargé UNIQUEMENT si un consommateur
// pointe `NATHAN_JIRA_PROFILE` dessus. Un tiers utilisant le cœur ne le touche jamais → les
// conventions NATHAN ne sont imposées à personne.
//
// Portage FIDÈLE du déterministe existant : lint de résumé (ex-jira-conventions), blocs A–L
// (ex-COMPONENTS de gestion/pm-stats), vocabulaire de statut (ex-mapping/deriveCategory).
// Volontairement ABSENT : route() et resolveDates() (design nouveau, pas un port).
import type { ConventionProfile, LintResult, StatusVocab } from './profile.js';

// --- Lint de résumé (CONVENTIONS-JIRA §7 : texte brut) ---
const MARKDOWN = /\*\*|__|`/;
const DECORATION = /[◆◇■□▶►★☆✦✱]/u;

/** Retire markdown/décoration et compacte les espaces — porté de gestion/summary-format.normalizeSummary. */
function normalizeSummary(summary: string): string {
  return summary
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/[◆◇■□▶►★☆✦✱]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function lintSummary(summary: string): LintResult {
  const reasons: string[] = [];
  if (MARKDOWN.test(summary)) reasons.push('markdown (** __ `)');
  if (DECORATION.test(summary)) reasons.push('symbole décoratif');
  if (summary !== summary.trim()) reasons.push('espaces en bord');
  if (/\s{2,}/.test(summary)) reasons.push('espaces multiples');
  if (reasons.length === 0) return { ok: true };
  return { ok: false, violations: reasons.join(', '), suggestion: normalizeSummary(summary) };
}

// --- Composantes NATHAN (blocs A–L) — portées de gestion/pm-stats.COMPONENTS ---
const COMPONENTS: ReadonlyArray<{ key: string; label: string; jiraLabel: string }> = [
  { key: 'A', label: 'Gestion et gouvernance', jiraLabel: 'bloc-gestion' },
  { key: 'B', label: 'Partenariat et conformité', jiraLabel: 'bloc-partenariat' },
  { key: 'C', label: 'Communauté DV', jiraLabel: 'bloc-communaute-dv' },
  { key: 'D', label: 'Livrables et évaluations académiques', jiraLabel: 'bloc-livrables' },
  { key: 'E', label: 'Moteur de jeu', jiraLabel: 'bloc-moteur-de-jeu' },
  { key: 'F', label: 'Audio spatial HRTF', jiraLabel: 'bloc-audio-hrtf' },
  { key: 'G', label: 'Bibliothèque AI', jiraLabel: 'bloc-bibliotheque-ai' },
  { key: 'H', label: 'Bibliothèque STT-TTS', jiraLabel: 'bloc-bibliotheque-stt-tts' },
  { key: 'I', label: 'IDE accessible', jiraLabel: 'bloc-ide' },
  { key: 'J', label: 'Site web et diffusion', jiraLabel: 'bloc-site-web' },
  { key: 'K', label: 'PCB / Électronique', jiraLabel: 'bloc-pcb' },
  { key: 'L', label: 'Boîtier', jiraLabel: 'bloc-boitier' },
];

/** Traduit une composante (clé « A »..« L », libellé, ou label JIRA) vers son/ses label(s) JIRA `bloc-*`. */
function mapLabels(bloc: string): string[] {
  const b = (bloc ?? '').trim().toLowerCase();
  if (!b) return [];
  const hit = COMPONENTS.find(
    (c) => c.key.toLowerCase() === b || c.label.toLowerCase() === b || c.jiraLabel.toLowerCase() === b,
  );
  return hit ? [hit.jiraLabel] : [];
}

// --- Vocabulaire de statut NATHAN — porté de jira-conventions.deriveCategory (sous-chaînes) ---
function statusVocab(): StatusVocab {
  return {
    done: ['terminé(e)', 'terminé', 'done', 'fermé', 'closed', 'résolu', 'resolved'],
    cancelled: ['annulé', 'annulée', 'cancelled', 'canceled'],
    blocked: ['bloqu', 'blocked'],
    review: ['révis', 'revis', 'review'],
    inProgress: ['cours', 'in progress'],
  };
}

/** Le profil de conventions NATHAN. Chargé via `loadProfile('@a-world-felt/nathan-jira-core/nathan-profile')`. */
export const profile: ConventionProfile = {
  name: 'nathan',
  lintSummary,
  mapLabels,
  statusVocab,
};

export default profile;
