/**
 * jira-write.ts — Primitives génériques d'écriture JIRA (write-path réutilisable).
 *
 * Couche bas-niveau partagée par l'outillage de gestion des tâches (taches-apply.ts).
 * Aucune logique de migration ici : seulement des opérations atomiques typées.
 *
 * SÉCURITÉ : ces fonctions font des écritures JIRA RÉELLES (POST/PUT/DELETE). Elles
 * ne doivent être appelées que derrière la double garde + snapshot préventif des CLIs
 * appelants (cf. taches-apply.ts, docs/CONVENTIONS-JIRA.md).
 */

import type { JiraHttpClient } from './types.js';
import { textToAdf } from './adf.js';

/** Type de dépendance entre tâches : Finish-to-Start (bloquant) ou Start-to-Start. */
export type DepType = 'FS' | 'SS';

/** Client minimal injecté dans toutes les fonctions d'écriture. */
export interface JiraWriteClient extends JiraHttpClient {
  /** id du champ « Start date » / « Date de début » — null si inconnu */
  startFieldId: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHeaders(client: JiraWriteClient): Record<string, string> {
  return {
    Authorization: client.authHeader,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Horodatage compatible nom de fichier (pas de ':' ni '.'). */
export function fileTimestamp(d: Date = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

/** Renvoie true si la chaîne ressemble à une clé JIRA réelle (ex. "LIVS-32"). */
export function isRealJiraKey(key: string): boolean {
  return /^[A-Z][A-Z0-9]+-\d+$/.test(key);
}

// ---------------------------------------------------------------------------
// Primitives d'écriture bas-niveau
// ---------------------------------------------------------------------------

/**
 * Crée un Epic dans un projet team-managed.
 * POST /rest/api/3/issue  (issuetype Epic). Renvoie la clé de l'epic créé.
 */
export async function createEpic(
  client: JiraWriteClient,
  project: string,
  name: string,
): Promise<string> {
  const body = {
    fields: {
      project: { key: project },
      issuetype: { name: 'Epic' },
      summary: name,
    },
  };
  const res = await client.fetchFn(`${client.baseUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: buildHeaders(client),
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 201) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`createEpic(${project}, "${name}") HTTP ${res.status}: ${text}`);
  }
  const data: { key: string } = await res.json();
  return data.key;
}

/**
 * Crée une Tâche rattachée à un Epic (board team-managed → champ `parent`).
 * POST /rest/api/3/issue  (issuetype Task, parent=epicKey, duedate, start-date, labels).
 * Renvoie la clé de la tâche créée.
 */
export async function createTask(
  client: JiraWriteClient,
  project: string,
  summary: string,
  epicKey: string,
  start: string | null,
  due: string | null,
  labels: string[],
): Promise<string> {
  const fields: Record<string, unknown> = {
    project: { key: project },
    issuetype: { name: 'Task' },
    summary,
    parent: { key: epicKey },
  };
  if (due) fields.duedate = due;
  if (start && client.startFieldId) fields[client.startFieldId] = start;
  if (labels.length > 0) fields.labels = labels;
  // NOTE : pas de timetracking à la création (time-tracking désactivé → HTTP 400).

  const res = await client.fetchFn(`${client.baseUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: buildHeaders(client),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok && res.status !== 201) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`createTask(${project}, "${summary}") HTTP ${res.status}: ${text}`);
  }
  const data: { key: string } = await res.json();
  return data.key;
}

/**
 * Crée une Sous-tâche rattachée à une Tâche parente.
 * POST /rest/api/3/issue  (issuetype Sous-tâche, parent=parentKey).
 * Renvoie la clé de la sous-tâche créée.
 */
export async function createSubtask(
  client: JiraWriteClient,
  project: string,
  summary: string,
  parentKey: string,
  fields: { start?: string | null; due?: string | null; labels?: string[] },
): Promise<string> {
  const f: Record<string, unknown> = {
    project: { key: project },
    issuetype: { name: 'Sous-tâche' },
    summary,
    parent: { key: parentKey },
  };
  if (fields.due) f.duedate = fields.due;
  if (fields.start && client.startFieldId) f[client.startFieldId] = fields.start;
  if (fields.labels?.length) f.labels = fields.labels;

  const res = await client.fetchFn(`${client.baseUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: buildHeaders(client),
    body: JSON.stringify({ fields: f }),
  });
  if (!res.ok && res.status !== 201) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(
      `createSubtask(${project}, "${summary}", parent=${parentKey}) HTTP ${res.status}: ${text}`,
    );
  }
  const data: { key: string } = await res.json();
  return data.key;
}

/**
 * Résout le statut courant d'une issue via un appel de lecture.
 * GET /rest/api/3/issue/{key}?fields=status → fields.status.name (ou null).
 */
export async function getCurrentStatus(
  client: JiraWriteClient,
  key: string,
): Promise<string | null> {
  const res = await client.fetchFn(
    `${client.baseUrl}/rest/api/3/issue/${key}?fields=status`,
    { headers: buildHeaders(client) },
  );
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`getCurrentStatus(${key}) GET HTTP ${res.status}: ${text}`);
  }
  const data: any = await res.json();
  return data.fields?.status?.name ?? null;
}

/**
 * Transitionne une issue vers le statut nommé `statusName`.
 *  1. GET ?fields=status → statut courant. Si déjà la cible → false (no-op silencieux).
 *  2. GET /transitions → trouve la transition to.name == cible.
 *  3. POST /transitions { transition: { id } }.
 * Renvoie true si une transition a été appliquée, false si déjà au bon statut.
 */
export async function transitionTo(
  client: JiraWriteClient,
  key: string,
  statusName: string,
): Promise<boolean> {
  const currentStatus = await getCurrentStatus(client, key);
  if (currentStatus && norm(currentStatus) === norm(statusName)) {
    return false; // déjà au bon statut → no-op silencieux
  }

  const tRes = await client.fetchFn(
    `${client.baseUrl}/rest/api/3/issue/${key}/transitions`,
    { headers: buildHeaders(client) },
  );
  if (!tRes.ok) {
    const text = (await tRes.text()).slice(0, 300);
    throw new Error(`transitionTo(${key}) GET transitions HTTP ${tRes.status}: ${text}`);
  }
  const tData: any = await tRes.json();

  const transitions: any[] = tData.transitions ?? [];
  const match = transitions.find((t) => norm(t.to?.name ?? '') === norm(statusName));
  if (!match) {
    throw new Error(`transitionTo(${key}) : transition vers "${statusName}" introuvable`);
  }

  const applyRes = await client.fetchFn(
    `${client.baseUrl}/rest/api/3/issue/${key}/transitions`,
    {
      method: 'POST',
      headers: buildHeaders(client),
      body: JSON.stringify({ transition: { id: match.id } }),
    },
  );
  if (!applyRes.ok && applyRes.status !== 204) {
    const text = (await applyRes.text()).slice(0, 300);
    throw new Error(`transitionTo(${key} → "${statusName}") HTTP ${applyRes.status}: ${text}`);
  }
  return true;
}

/**
 * Crée un lien typé entre un prérequis et une tâche.
 *   FS (Finish-to-Start) → lien « Blocks » : prereq BLOCKS task.
 *   SS (Start-to-Start)  → lien « relates to » (non bloquant, symétrique).
 * POST /rest/api/3/issueLink.
 *
 * SENS (vérifié empiriquement) : JIRA crée le lien comme « inwardIssue <outward> outwardIssue »
 * — c'est l'**inwardIssue qui porte le rôle actif** (« blocks »). Donc pour « prereq blocks task »,
 * il faut `inwardIssue = prereq` et `outwardIssue = task`.
 */
export async function linkDep(
  client: JiraWriteClient,
  prereqKey: string,
  taskKey: string,
  type: DepType,
): Promise<void> {
  const bodyObj: Record<string, unknown> = {
    type: { name: type === 'FS' ? 'Blocks' : 'Relates' },
    inwardIssue: { key: prereqKey },
    outwardIssue: { key: taskKey },
  };
  const res = await client.fetchFn(`${client.baseUrl}/rest/api/3/issueLink`, {
    method: 'POST',
    headers: buildHeaders(client),
    body: JSON.stringify(bodyObj),
  });
  if (!res.ok && res.status !== 201) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`linkDep(${prereqKey} ${type} ${taskKey}) HTTP ${res.status}: ${text}`);
  }
}

/**
 * Restructure une issue existante : rattache à l'epic + pose les dates.
 * PUT /rest/api/3/issue/{key}  (parent=epicKey, duedate, start-date).
 * NE TOUCHE PAS au statut existant.
 */
export async function restructureOriginal(
  client: JiraWriteClient,
  key: string,
  epicKey: string,
  start: string | null,
  due: string | null,
): Promise<void> {
  const fields: Record<string, unknown> = {
    parent: { key: epicKey },
  };
  if (due) fields.duedate = due;
  if (start && client.startFieldId) fields[client.startFieldId] = start;

  const res = await client.fetchFn(`${client.baseUrl}/rest/api/3/issue/${key}`, {
    method: 'PUT',
    headers: buildHeaders(client),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok && res.status !== 204) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`restructureOriginal(${key}) HTTP ${res.status}: ${text}`);
  }
}

/**
 * Supprime une issue.
 * DELETE /rest/api/3/issue/{key}?deleteSubtasks=true.
 */
export async function deleteIssue(client: JiraWriteClient, key: string): Promise<void> {
  const res = await client.fetchFn(
    `${client.baseUrl}/rest/api/3/issue/${key}?deleteSubtasks=true`,
    { method: 'DELETE', headers: buildHeaders(client) },
  );
  if (!res.ok && res.status !== 204) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`deleteIssue(${key}) HTTP ${res.status}: ${text}`);
  }
}

/**
 * Supprime un lien entre deux issues par son ID.
 * DELETE /rest/api/3/issueLink/{linkId}.
 */
export async function deleteIssueLink(client: JiraWriteClient, linkId: string): Promise<void> {
  const res = await client.fetchFn(`${client.baseUrl}/rest/api/3/issueLink/${linkId}`, {
    method: 'DELETE',
    headers: buildHeaders(client),
  });
  if (!res.ok && res.status !== 204) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`deleteIssueLink(${linkId}) HTTP ${res.status}: ${text}`);
  }
}

/**
 * Reporte le statut d'une issue sur une autre, PUIS supprime la première.
 *   1. transitionTo(jumeauConserve, statutAReporter)
 *   2. deleteIssue(cleASupprimer)
 */
export async function carryStatusThenDelete(
  client: JiraWriteClient,
  cleASupprimer: string,
  jumeauConserve: string,
  statutAReporter: string,
): Promise<void> {
  await transitionTo(client, jumeauConserve, statutAReporter);
  await deleteIssue(client, cleASupprimer);
}

/**
 * Crée un risque dans le projet RISK.
 * POST /rest/api/3/issue (issuetype Task), summary=nom, labels=bloc-*,
 * description = sévérité + mitigation (ADF texte simple). Renvoie la clé créée.
 */
export async function createRisk(
  client: JiraWriteClient,
  project: string,
  nom: string,
  severite: string,
  mitigation: string,
  labels: string[],
): Promise<string> {
  const descText = `Sévérité : ${severite}\nMitigation : ${mitigation}`;
  const fields: Record<string, unknown> = {
    project: { key: project },
    issuetype: { name: 'Task' },
    summary: nom,
    description: textToAdf(descText),
  };
  if (labels.length > 0) fields.labels = labels;

  const res = await client.fetchFn(`${client.baseUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: buildHeaders(client),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok && res.status !== 201) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`createRisk("${nom}") HTTP ${res.status}: ${text}`);
  }
  const data: { key: string } = await res.json();
  return data.key;
}
