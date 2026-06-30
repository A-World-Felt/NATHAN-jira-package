// src/restore.ts
// Logique pure de restauration JIRA depuis un snapshot (pas de fs, pas de CLI).
// Portée de gestion/src/restore.ts. L'interface JiraClient locale est remplacée par
// JiraHttpClient du core (même forme, plus de collision de nom).

import type { RawIssue } from './snapshot.js';
import type { JiraHttpClient } from './types.js';

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export interface FieldDiff {
  key: string;
  field: string;
  current: unknown;
  snapshot: unknown;
}

export interface SnapshotDiff {
  toRevert: FieldDiff[];
  missingNow: string[];  // dans snapshot, absentes du live — non recréables
  extraNow: string[];    // dans live, absentes du snapshot — créées après ; jamais supprimées
}

// ---------------------------------------------------------------------------
// RESTORABLE_FIELDS
// ---------------------------------------------------------------------------

const RESTORABLE_FIELDS = [
  'summary', 'status', 'assignee', 'parentKey', 'labels', 'start', 'due',
  'estimateHours', 'description', 'priority',
] as const satisfies ReadonlyArray<keyof RawIssue>;

function fieldEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return [...a].sort().join('\0') === [...b].sort().join('\0');
  }
  return a === b;
}

// ---------------------------------------------------------------------------
// diffSnapshot — PURE
// ---------------------------------------------------------------------------

export function diffSnapshot(
  currentIssues: RawIssue[],
  snapshotIssues: RawIssue[],
): SnapshotDiff {
  const currentMap = new Map(currentIssues.map((i) => [i.key, i]));
  const snapshotMap = new Map(snapshotIssues.map((i) => [i.key, i]));
  const toRevert: FieldDiff[] = [];

  for (const [key, snapIssue] of snapshotMap) {
    const cur = currentMap.get(key);
    if (!cur) continue;
    for (const field of RESTORABLE_FIELDS) {
      if (!fieldEqual(cur[field], snapIssue[field])) {
        toRevert.push({ key, field, current: cur[field], snapshot: snapIssue[field] });
      }
    }
  }

  const missingNow = snapshotIssues.filter((i) => !currentMap.has(i.key)).map((i) => i.key);
  const extraNow = currentIssues.filter((i) => !snapshotMap.has(i.key)).map((i) => i.key);
  return { toRevert, missingNow, extraNow };
}

// ---------------------------------------------------------------------------
// canApplyRestore — PURE guard
// ---------------------------------------------------------------------------

export function canApplyRestore(args: string[]): boolean {
  return args.includes('--apply') && args.includes('--yes-i-want-to-overwrite-jira');
}

// ---------------------------------------------------------------------------
// revertFields — WRITES to JIRA (injecté via JiraHttpClient)
// ---------------------------------------------------------------------------

export async function revertFields(
  client: JiraHttpClient,
  toRevert: FieldDiff[],
): Promise<{ succeeded: string[]; failed: Array<{ key: string; field: string; error: string }> }> {
  const byKey = new Map<string, FieldDiff[]>();
  for (const diff of toRevert) {
    if (!byKey.has(diff.key)) byKey.set(diff.key, []);
    byKey.get(diff.key)!.push(diff);
  }

  const succeeded: string[] = [];
  const failed: Array<{ key: string; field: string; error: string }> = [];

  for (const [key, diffs] of byKey) {
    const fieldUpdates = diffs.filter((d) => d.field !== 'status');
    const statusDiff = diffs.find((d) => d.field === 'status');

    if (fieldUpdates.length > 0) {
      const updateBody: Record<string, unknown> = {};
      for (const diff of fieldUpdates) {
        switch (diff.field) {
          case 'summary': updateBody.summary = diff.snapshot; break;
          case 'assignee': break; // skip — accountId non disponible dans snapshot
          case 'parentKey': updateBody.parent = diff.snapshot ? { key: diff.snapshot } : null; break;
          case 'labels': updateBody.labels = diff.snapshot; break;
          case 'due': updateBody.duedate = diff.snapshot; break;
          case 'priority': updateBody.priority = diff.snapshot ? { name: diff.snapshot } : null; break;
          case 'description':
            updateBody.description = diff.snapshot
              ? { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: diff.snapshot }] }] }
              : null;
            break;
          case 'estimateHours':
            updateBody.timetracking = diff.snapshot !== null ? { originalEstimate: `${diff.snapshot}h` } : {};
            break;
          case 'start': break; // champ personnalisé — id inconnu à ce stade ; skip sûr
        }
      }
      if (Object.keys(updateBody).length > 0) {
        const res = await client.fetchFn(`${client.baseUrl}/rest/api/3/issue/${key}`, {
          method: 'PUT',
          headers: { Authorization: client.authHeader, Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: updateBody }),
        });
        if (res.ok || res.status === 204) {
          succeeded.push(`${key}:fields`);
        } else {
          const text = (await res.text()).slice(0, 200);
          for (const d of fieldUpdates) {
            failed.push({ key, field: d.field, error: `HTTP ${res.status}: ${text}` });
          }
        }
      }
    }

    if (statusDiff) {
      const targetStatus = statusDiff.snapshot as string;
      const tRes = await client.fetchFn(`${client.baseUrl}/rest/api/3/issue/${key}/transitions`, {
        headers: { Authorization: client.authHeader, Accept: 'application/json' },
      });
      if (!tRes.ok) {
        failed.push({ key, field: 'status', error: `HTTP ${tRes.status} fetching transitions` });
        continue;
      }
      const tData: any = await tRes.json();
      const transition = (tData.transitions ?? []).find((t: any) => t.to?.name === targetStatus);
      if (!transition) {
        failed.push({ key, field: 'status', error: `Transition vers "${targetStatus}" introuvable` });
        continue;
      }
      const applyRes = await client.fetchFn(`${client.baseUrl}/rest/api/3/issue/${key}/transitions`, {
        method: 'POST',
        headers: { Authorization: client.authHeader, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ transition: { id: transition.id } }),
      });
      if (applyRes.ok || applyRes.status === 204) {
        succeeded.push(`${key}:status`);
      } else {
        failed.push({ key, field: 'status', error: `HTTP ${applyRes.status}: ${(await applyRes.text()).slice(0, 200)}` });
      }
    }
  }
  return { succeeded, failed };
}
