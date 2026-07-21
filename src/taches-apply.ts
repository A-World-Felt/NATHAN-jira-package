// src/taches-apply.ts
// Use-case : appliquer des changements de tâches dans JIRA.
// Porté de gestion/src/taches-apply.ts. Aucun fs, aucun CLI, aucun guard I/O ici.
// La lecture des fichiers, les snapshots préventifs et la double garde restent dans gestion.
// Identité tâche <-> issue JIRA : la clé JIRA (idV2 est un handle intra-changeset, pas une identité).

import {
  createTask,
  createSubtask,
  transitionTo,
  linkDep,
  deleteIssue,
  resolveAccountId,
  setAssignee,
  setEstimate,
  type JiraWriteClient,
  type DepType,
} from './jira-write.js';
import { type SnapshotIndex, type RawIssue } from './snapshot.js';
import { lintSummary } from './jira-conventions.js';

// ---------------------------------------------------------------------------
// Schéma du fichier de changements
// ---------------------------------------------------------------------------

export interface ChangeDep { ref: string; type: DepType; existingKey?: boolean }

export interface SubtaskChange {
  idV2: string;
  nom: string;
  debut?: string | null;
  fin?: string | null;
  labels?: string[];
  assignee?: string | null;
  estimateHours?: number | null;
}

export interface CreateChange {
  idV2: string;
  nom: string;
  projet: string;
  epic: string;
  statutInitial: string;
  debut?: string | null;
  fin?: string | null;
  labels?: string[];
  dependsOn?: ChangeDep[];
  subtasks?: SubtaskChange[];
  assignee?: string | null;
  estimateHours?: number | null;
}

export interface UpdateChange {
  ref: string;
  statut?: string;
  debut?: string;
  fin?: string;
  summary?: string;
  epic?: string;
  addLabels?: string[];
  dependsOn?: ChangeDep[];
  assignee?: string | null;
  estimateHours?: number | null;
  subtasks?: SubtaskChange[];
}

export interface DeleteChange {
  ref: string;
  raison?: string;
}

export interface ChangeSet {
  meta?: Record<string, unknown>;
  create?: CreateChange[];
  update?: UpdateChange[];
  delete?: DeleteChange[];
}

// ---------------------------------------------------------------------------
// Résolution & vérifications (PURE)
// ---------------------------------------------------------------------------

/**
 * Résout une référence (`idV2` d'un `create` du même changeset, ou clé JIRA existante)
 * vers une clé JIRA réelle. `created` = map idV2 -> clé, remplie au fil de `applyChanges`.
 */
function resolveRef(
  ref: string,
  existingKey: boolean | undefined,
  idx: SnapshotIndex,
  created: Map<string, string>,
): string | null {
  if (existingKey) return idx.keys.has(ref) ? ref : null;
  return created.get(ref) ?? (idx.keys.has(ref) ? ref : null);
}

export interface ChangeCheck {
  warnings: string[];
  errors: string[];
  createCount: number;
  updateCount: number;
  linkCount: number;
  subtaskCount: number;
  deleteCount: number;
  assigneeCount: number;
  estimateCount: number;
}

export function checkChanges(cs: ChangeSet, idx: SnapshotIndex): ChangeCheck {
  const warnings: string[] = [];
  const errors: string[] = [];
  const lint = (label: string, summary: string | undefined): void => {
    if (summary == null) return;
    const v = lintSummary(summary);
    if (v) errors.push(`${label} : résumé non conforme (${v}) — "${summary}"`);
  };
  const willCreate = new Set((cs.create ?? []).map((c) => c.idV2));
  let linkCount = 0;
  let subtaskCount = 0;
  let assigneeCount = 0;
  let estimateCount = 0;
  const countAE = (item: { assignee?: string | null; estimateHours?: number | null }): void => {
    if (item.assignee !== undefined) assigneeCount++;
    if (item.estimateHours !== undefined) estimateCount++;
  };

  for (const c of cs.create ?? []) {
    if (!idx.epics.has(c.epic)) warnings.push(`CREATE ${c.idV2} : epic ${c.epic} introuvable.`);
    lint(`CREATE ${c.idV2}`, c.nom);
    countAE(c);
    for (const s of c.subtasks ?? []) {
      subtaskCount++;
      lint(`CREATE ${c.idV2} / sous-tâche ${s.idV2}`, s.nom);
      countAE(s);
    }
    for (const d of c.dependsOn ?? []) {
      linkCount++;
      const ok = d.existingKey
        ? idx.keys.has(d.ref)
        : (willCreate.has(d.ref) || idx.keys.has(d.ref));
      if (!ok) warnings.push(`CREATE ${c.idV2} : prérequis ${d.ref} non résolu — lien ignoré.`);
    }
  }
  for (const u of cs.update ?? []) {
    const key = idx.keys.has(u.ref) ? u.ref : null;
    if (!key) warnings.push(`UPDATE ${u.ref} : issue introuvable (clé JIRA inconnue).`);
    if (u.epic && !idx.epics.has(u.epic)) warnings.push(`UPDATE ${u.ref} : epic cible ${u.epic} introuvable.`);
    lint(`UPDATE ${u.ref}`, u.summary);
    countAE(u);
    for (const s of u.subtasks ?? []) {
      subtaskCount++;
      lint(`UPDATE ${u.ref} / sous-tâche ${s.idV2}`, s.nom);
      countAE(s);
    }
    for (const d of u.dependsOn ?? []) {
      linkCount++;
      const ok = d.existingKey
        ? idx.keys.has(d.ref)
        : (willCreate.has(d.ref) || idx.keys.has(d.ref));
      if (!ok) warnings.push(`UPDATE ${u.ref} : prérequis ${d.ref} non résolu — lien ignoré.`);
    }
  }
  for (const d of cs.delete ?? []) {
    const key = idx.keys.has(d.ref) ? d.ref : null;
    if (!key) warnings.push(`DELETE ${d.ref} : issue introuvable (clé JIRA inconnue) — ignorée.`);
  }
  return {
    warnings, errors,
    createCount: (cs.create ?? []).length,
    updateCount: (cs.update ?? []).length,
    linkCount, subtaskCount,
    deleteCount: (cs.delete ?? []).length,
    assigneeCount, estimateCount,
  };
}

export function dryRun(cs: ChangeSet, idx: SnapshotIndex): string {
  const c = checkChanges(cs, idx);
  const L: string[] = [];
  const bar = '='.repeat(72);
  L.push(bar, 'DRY-RUN — Changements de tâches JIRA (AUCUNE écriture)', bar, '');
  L.push(`  Créations : ${c.createCount}   ·   Sous-tâches : ${c.subtaskCount}   ·   Mises à jour : ${c.updateCount}   ·   Assignations : ${c.assigneeCount}   ·   Estimations : ${c.estimateCount}   ·   Liens : ${c.linkCount}   ·   Suppressions : ${c.deleteCount}`, '');
  if (cs.create?.length) {
    L.push('CRÉATIONS', '-'.repeat(40));
    for (const x of cs.create) {
      L.push(`  + [${x.projet}] ${x.idV2} → epic ${x.epic}  (${x.statutInitial})`);
      L.push(`      "${x.nom}"   ${x.debut ?? '—'} → ${x.fin ?? '—'}`);
      if (x.assignee !== undefined) L.push(`      assignee → ${x.assignee ?? '(désassigné)'}`);
      if (x.estimateHours !== undefined) L.push(`      estimation → ${x.estimateHours ?? '(effacée)'}h`);
      for (const d of x.dependsOn ?? []) L.push(`      dep ${d.type}: ${d.ref}`);
      for (const s of x.subtasks ?? []) {
        L.push(`      ↳ ${s.idV2}  "${s.nom}"   ${s.debut ?? '—'} → ${s.fin ?? '—'}`);
        if (s.assignee !== undefined) L.push(`          assignee → ${s.assignee ?? '(désassigné)'}`);
        if (s.estimateHours !== undefined) L.push(`          estimation → ${s.estimateHours ?? '(effacée)'}h`);
      }
    }
    L.push('');
  }
  if (cs.update?.length) {
    L.push('MISES À JOUR', '-'.repeat(40));
    for (const u of cs.update) {
      const parts = [
        u.statut ? `statut→"${u.statut}"` : '',
        u.debut ? `début→${u.debut}` : '',
        u.fin ? `fin→${u.fin}` : '',
        u.summary ? 'summary' : '',
        u.epic ? `epic→${u.epic}` : '',
        u.addLabels?.length ? `+labels[${u.addLabels.join(',')}]` : '',
        u.assignee !== undefined ? `assignee→${u.assignee ?? '(désassigné)'}` : '',
        u.estimateHours !== undefined ? `estimation→${u.estimateHours ?? '(effacée)'}h` : '',
      ].filter(Boolean);
      L.push(`  ~ ${u.ref}  ${parts.join(' · ') || '(liens seulement)'}`);
      for (const d of u.dependsOn ?? []) L.push(`      dep ${d.type}: ${d.ref}`);
      for (const s of u.subtasks ?? []) {
        L.push(`      ↳ NOUVELLE sous-tâche ${s.idV2}  "${s.nom}"   ${s.debut ?? '—'} → ${s.fin ?? '—'}`);
        if (s.assignee !== undefined) L.push(`          assignee → ${s.assignee ?? '(désassigné)'}`);
        if (s.estimateHours !== undefined) L.push(`          estimation → ${s.estimateHours ?? '(effacée)'}h`);
      }
    }
    L.push('');
  }
  if (cs.delete?.length) {
    L.push('SUPPRESSIONS (irréversible — cascade aux sous-tâches ; snapshot préventif avant apply)', '-'.repeat(40));
    for (const d of cs.delete) {
      L.push(`  − ${d.ref}${d.raison ? '   « ' + d.raison + ' »' : ''}`);
    }
    L.push('');
  }
  L.push('-'.repeat(72), `VÉRIFICATIONS — ${c.errors.length} erreur(s) bloquante(s), ${c.warnings.length} avertissement(s)`);
  if (!c.errors.length && !c.warnings.length) L.push('  ✓ tout résolu.');
  for (const e of c.errors) L.push(`  ⛔ ${e}`);
  for (const w of c.warnings) L.push(`  ⚠️  ${w}`);
  if (c.errors.length) L.push('', '  ⛔ Des erreurs BLOQUANTES empêchent l\'apply — corrige les résumés.');
  L.push('', bar, 'FIN DU DRY-RUN', bar);
  return L.join('\n');
}

export function canApply(args: string[]): boolean {
  return (args.includes('apply') || args.includes('--apply')) && args.includes('--yes-i-want-to-write-jira');
}

// ---------------------------------------------------------------------------
// updateFields — primitive PUT (injecte client)
// ---------------------------------------------------------------------------

export async function updateFields(
  client: JiraWriteClient,
  key: string,
  fields: { summary?: string; due?: string; start?: string; parentKey?: string; labels?: string[] },
): Promise<void> {
  const f: Record<string, unknown> = {};
  if (fields.summary != null) f.summary = fields.summary;
  if (fields.due != null) f.duedate = fields.due;
  if (fields.start != null && client.startFieldId) f[client.startFieldId] = fields.start;
  if (fields.parentKey != null) f.parent = { key: fields.parentKey };
  if (fields.labels != null) f.labels = fields.labels;
  if (Object.keys(f).length === 0) return;
  const res = await client.fetchFn(`${client.baseUrl}/rest/api/3/issue/${key}`, {
    method: 'PUT',
    headers: { Authorization: client.authHeader, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: f }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`updateFields(${key}) HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// ApplyResult + applyChanges
// ---------------------------------------------------------------------------

export interface ApplyResult {
  created: Array<{ idV2: string; key: string }>;
  subtasks: Array<{ idV2: string; key: string }>;
  updated: string[];
  links: Array<{ prereq: string; task: string; type: DepType }>;
  deleted: string[];
  errors: string[];
}

export async function applyChanges(
  client: JiraWriteClient,
  cs: ChangeSet,
  idx: SnapshotIndex,
  issues: RawIssue[],
  log: (m: string) => void = () => {},
): Promise<ApplyResult> {
  const result: ApplyResult = { created: [], subtasks: [], updated: [], links: [], deleted: [], errors: [] };
  const created = new Map<string, string>();
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const assigneeCache = new Map<string, string>();

  // 1) Créations
  for (const x of cs.create ?? []) {
    try {
      const accountId = x.assignee === undefined
        ? undefined
        : x.assignee === null ? null : await resolveAccountId(client, x.assignee, assigneeCache);
      const key = await createTask(
        client, x.projet, x.nom, x.epic,
        x.debut ?? null, x.fin ?? null,
        x.labels ?? [],
        { accountId, estimateHours: x.estimateHours },
      );
      created.set(x.idV2, key);
      result.created.push({ idV2: x.idV2, key });
      log(`  [OK] créé ${x.idV2} → ${key}`);
      try { await transitionTo(client, key, x.statutInitial); }
      catch (e) { result.errors.push(`transition ${x.idV2}: ${(e as Error).message}`); }
      for (const s of x.subtasks ?? []) {
        try {
          const subAccountId = s.assignee === undefined
            ? undefined
            : s.assignee === null ? null : await resolveAccountId(client, s.assignee, assigneeCache);
          const subKey = await createSubtask(client, x.projet, s.nom, key, {
            start: s.debut ?? null,
            due: s.fin ?? null,
            labels: s.labels ?? [],
            accountId: subAccountId,
            estimateHours: s.estimateHours,
          });
          result.subtasks.push({ idV2: s.idV2, key: subKey });
          log(`    [OK] sous-tâche ${s.idV2} → ${subKey} (parent ${key})`);
        } catch (e) {
          result.errors.push(`subtask ${s.idV2}: ${(e as Error).message}`);
          log(`    [ERREUR] subtask ${s.idV2}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      result.errors.push(`create ${x.idV2}: ${(e as Error).message}`);
      log(`  [ERREUR] create ${x.idV2}: ${(e as Error).message}`);
    }
  }

  // 2) Mises à jour
  for (const u of cs.update ?? []) {
    const key = idx.keys.has(u.ref) ? u.ref : null;
    if (!key) { result.errors.push(`update ${u.ref}: introuvable`); continue; }
    try {
      let labels: string[] | undefined;
      if (u.addLabels?.length) {
        const cur = byKey.get(key)?.labels ?? [];
        labels = [...new Set([...cur, ...u.addLabels])];
      }
      await updateFields(client, key, { summary: u.summary, due: u.fin, start: u.debut, parentKey: u.epic, labels });
      if (u.statut) {
        try { await transitionTo(client, key, u.statut); }
        catch (e) { result.errors.push(`transition ${u.ref}: ${(e as Error).message}`); }
      }
      result.updated.push(key);
      log(`  [OK] maj ${u.ref} (${key})`);
    } catch (e) {
      result.errors.push(`update ${u.ref}: ${(e as Error).message}`);
      log(`  [ERREUR] update ${u.ref}: ${(e as Error).message}`);
    }
  }

  // 3) Liens (après créations + MAJ)
  const allDeps: Array<{ self: string; deps: ChangeDep[] }> = [];
  for (const x of cs.create ?? []) if (x.dependsOn?.length) allDeps.push({ self: x.idV2, deps: x.dependsOn });
  for (const u of cs.update ?? []) if (u.dependsOn?.length) allDeps.push({ self: u.ref, deps: u.dependsOn });
  for (const item of allDeps) {
    const taskKey = resolveRef(item.self, false, idx, created);
    if (!taskKey) { log(`  [SKIP] ${item.self} non résolu pour liens`); continue; }
    for (const d of item.deps) {
      const prereqKey = resolveRef(d.ref, d.existingKey, idx, created);
      if (!prereqKey) { log(`  [SKIP] dép ${d.ref} non résolue`); continue; }
      try {
        await linkDep(client, prereqKey, taskKey, d.type);
        result.links.push({ prereq: prereqKey, task: taskKey, type: d.type });
        log(`  [OK] ${prereqKey} ${d.type} ${taskKey}`);
      } catch (e) {
        result.errors.push(`link ${prereqKey} ${d.type} ${taskKey}: ${(e as Error).message}`);
      }
    }
  }

  // 4) Suppressions — EN DERNIER, uniquement si aucune erreur avant
  if (cs.delete?.length) {
    if (result.errors.length) {
      log(`  [SKIP] ${cs.delete.length} suppression(s) ANNULÉE(S) : ${result.errors.length} erreur(s) avant la phase de suppression.`);
    } else {
      for (const d of cs.delete) {
        const key = idx.keys.has(d.ref) ? d.ref : null;
        if (!key) {
          result.errors.push(`delete ${d.ref}: introuvable`);
          log(`  [SKIP] delete ${d.ref} introuvable`);
          continue;
        }
        try {
          await deleteIssue(client, key);
          result.deleted.push(key);
          log(`  [OK] supprimé ${d.ref} (${key})`);
        } catch (e) {
          result.errors.push(`delete ${d.ref} (${key}): ${(e as Error).message}`);
          log(`  [ERREUR] delete ${d.ref}: ${(e as Error).message}`);
        }
      }
    }
  }

  log(`[taches:apply] Terminé. Créées:${result.created.length} MAJ:${result.updated.length} Liens:${result.links.length} Suppr:${result.deleted.length} Erreurs:${result.errors.length}`);
  return result;
}
