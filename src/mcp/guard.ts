// src/mcp/guard.ts — Garde d'écriture du serveur MCP (modèle B).
//
// Invariant : aucune mutation JIRA ne peut avoir lieu sans
//   (1) un planId FRAIS (non expiré, non déjà consommé),
//   (2) un état live NON DÉRIVÉ depuis la proposition (anti-dérive par empreinte),
//   (3) un snapshot préventif écrit AVANT toute écriture.
//
// Aucune I/O ni réseau ici : tout est injecté (GuardDeps) → module PUR et testable.
import type { ChangeSet } from '../taches-apply.js';
import type { ApplyResult } from '../taches-apply.js';
import type { RawIssue, SnapshotIndex } from '../snapshot.js';

export type Clock = () => number;

export interface StoredPlan {
  changeset: ChangeSet;
  refs: string[];        // clés JIRA existantes touchées (surveillées pour la dérive)
  fingerprint: string;   // empreinte de l'état de ces refs au moment de la proposition
  preview: string;       // aperçu humain montré à l'utilisateur avant apply
}

/** Collecte les clés JIRA EXISTANTES touchées par un changeset (base de l'anti-dérive). */
export function collectRefs(cs: ChangeSet): string[] {
  const refs = new Set<string>();
  for (const u of cs.update ?? []) {
    refs.add(u.ref);
    for (const dep of u.dependsOn ?? []) if (dep.existingKey) refs.add(dep.ref);
  }
  for (const d of cs.delete ?? []) refs.add(d.ref);
  for (const c of cs.create ?? []) {
    for (const dep of c.dependsOn ?? []) if (dep.existingKey) refs.add(dep.ref);
  }
  return [...refs];
}

/** Empreinte déterministe des issues référencées (champs mutables), stable par tri de clé. */
export function computeFingerprint(issues: RawIssue[], refs: string[]): string {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  return [...refs].sort().map((k) => {
    const i = byKey.get(k);
    if (!i) return `${k}:ABSENT`;
    const labels = (i.labels ?? []).slice().sort().join(',');
    return `${k}:${i.status}|${i.summary}|${i.assignee ?? ''}|${labels}|${i.start ?? ''}|${i.due ?? ''}|${i.parentKey ?? ''}`;
  }).join('\n');
}

/** Registre en mémoire des plans proposés (durée de vie = process serveur stdio). */
export class PlanStore {
  private plans = new Map<string, StoredPlan & { createdAt: number }>();
  private seq = 0;
  constructor(private now: Clock, private ttlMs: number, private idPrefix = 'plan') {}

  /** Enregistre un plan proposé, renvoie son identifiant. */
  put(plan: StoredPlan): string {
    const id = `${this.idPrefix}-${++this.seq}`;
    this.plans.set(id, { ...plan, createdAt: this.now() });
    return id;
  }

  /** Renvoie ET CONSOMME le plan (usage unique). null si inconnu ou expiré. */
  take(id: string): StoredPlan | null {
    const p = this.plans.get(id);
    if (!p) return null;
    this.plans.delete(id);
    if (this.now() - p.createdAt > this.ttlMs) return null;
    return p;
  }
}

export interface GuardDeps {
  store: PlanStore;
  /** Récupère l'état JIRA live (pour anti-dérive + base de l'apply). */
  fetchSnapshot: () => Promise<{ issues: RawIssue[] }>;
  /** Écrit un snapshot préventif sur disque ; renvoie son chemin. */
  writeSnapshot: (issues: RawIssue[]) => Promise<string>;
  /** Indexe un snapshot pour applyChanges. */
  indexSnapshot: (issues: RawIssue[]) => SnapshotIndex;
  /** Applique réellement le changeset (écritures JIRA). */
  applyChanges: (cs: ChangeSet, idx: SnapshotIndex, issues: RawIssue[]) => Promise<ApplyResult>;
}

export type GuardOutcome =
  | { ok: false; reason: 'unknown_or_expired' }
  | { ok: false; reason: 'drift'; details: string }
  | { ok: true; snapshotPath: string; result: ApplyResult };

/**
 * Applique un plan sous garde. Ordre imposé :
 *   take(planId) → fetch live → anti-dérive → snapshot préventif → applyChanges.
 * Toute étape de refus se produit AVANT le moindre snapshot ou écriture.
 */
export async function applyGuarded(deps: GuardDeps, planId: string): Promise<GuardOutcome> {
  const plan = deps.store.take(planId);
  if (!plan) return { ok: false, reason: 'unknown_or_expired' };

  const fresh = await deps.fetchSnapshot();

  const nowFingerprint = computeFingerprint(fresh.issues, plan.refs);
  if (nowFingerprint !== plan.fingerprint) {
    return { ok: false, reason: 'drift', details: "l'état JIRA a changé depuis la proposition — reproposer le changement" };
  }

  const snapshotPath = await deps.writeSnapshot(fresh.issues);
  const idx = deps.indexSnapshot(fresh.issues);
  const result = await deps.applyChanges(plan.changeset, idx, fresh.issues);
  return { ok: true, snapshotPath, result };
}
