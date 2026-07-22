// src/profile.ts — Interface de PROFIL de conventions (plugin) + chargeur.
// Le cœur reste NEUTRE : il définit le contrat, un profil optionnel l'implémente
// (cf. nathan-jira-profile). Sans profil → pure plomberie.

/** Intention de routage : le résumé libre + un indice optionnel (ex. « livrable », « risque »). */
export interface RouteIntent { summary: string; hint?: string; }
/** Résultat de routage : projet cible + epic + labels, décidés par le profil. */
export interface RouteResult { project: string; epicKey?: string; labels?: string[]; }
/** Résultat de lint d'un résumé selon la convention du profil. */
export interface LintResult { ok: boolean; violations?: string; suggestion?: string; }
/** Vocabulaire de statut fourni par le profil pour la catégorisation (deriveCategory data-driven). */
export interface StatusVocab {
  done: string[]; cancelled: string[]; blocked: string[]; review: string[]; inProgress: string[];
}

/** Contrat d'un profil de conventions. Tous les membres (hors `name`) sont OPTIONNELS :
 *  le serveur consulte seulement ce que le profil fournit. */
export interface ConventionProfile {
  name: string;
  route?(intent: RouteIntent): RouteResult;
  lintSummary?(summary: string): LintResult;
  resolveDates?(hint: string): { start?: string | null; due?: string | null };
  mapLabels?(bloc: string): string[];
  statusVocab?(): StatusVocab;
}

/**
 * Charge un profil depuis un spécificateur de module (nom de package ou chemin).
 * NE LÈVE JAMAIS : renvoie `null` (avec avertissement) si `spec` absent, import échoué,
 * ou export invalide (pas de champ `name`). Le profil est optionnel par construction.
 * `importer` est injectable pour les tests (défaut : import dynamique ESM).
 */
export async function loadProfile(
  spec: string | undefined,
  importer: (s: string) => Promise<unknown> = (s) => import(s),
): Promise<ConventionProfile | null> {
  if (!spec) return null;
  try {
    const mod = (await importer(spec)) as Record<string, unknown>;
    const candidate = (mod?.profile ?? mod?.default ?? mod) as Partial<ConventionProfile> | undefined;
    if (candidate && typeof candidate.name === 'string') {
      return candidate as ConventionProfile;
    }
    console.warn(`[nathan-jira] profil « ${spec} » chargé mais invalide (champ « name » manquant) — mode plomberie.`);
    return null;
  } catch (e) {
    console.warn(`[nathan-jira] échec de chargement du profil « ${spec} » : ${(e as Error).message} — mode plomberie.`);
    return null;
  }
}
