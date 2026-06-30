// src/snapshot.ts
// Logique pure de snapshot JIRA (lecture seule, pas de fs ni git).
// Portée de gestion/src/snapshot.ts. Tout I/O fichier reste dans gestion.

import type { JiraConnConfig } from './types.js';

type FetchFn = typeof fetch;

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export interface RawIssue {
  key: string;
  project: string;
  issuetype: string;
  summary: string;
  description: string | null;
  status: string;
  assignee: string | null;
  parentKey: string | null;
  labels: string[];
  start: string | null;
  due: string | null;
  estimateHours: number | null;
  priority: string | null;
  links: Array<{ type: string; inwardKey?: string; outwardKey?: string }>;
}

export interface JiraSnapshot {
  takenAt: string;
  baseUrl: string;
  projectKeys: string[];
  count: number;
  issues: RawIssue[];
}

export interface SnapshotIndex {
  /** label `nid-<ID>` → clé JIRA réelle */
  nidToKey: Map<string, string>;
  /** ensemble de toutes les clés présentes */
  keys: Set<string>;
  /** ensemble des clés d'Epic */
  epics: Set<string>;
}

// ---------------------------------------------------------------------------
// Helpers privés
// ---------------------------------------------------------------------------

/** Extrait le texte brut d'un nœud ADF (best-effort, sans \n après paragraphe).
 *  Intentionnellement différent de adfToText : stockage snapshot = pas de retours chariot. */
function extractAdfText(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (Array.isArray(node.content)) {
    return node.content.map(extractAdfText).join('');
  }
  return '';
}

async function resolveStartDateField(
  baseUrl: string,
  authHeader: string,
  fetchFn: FetchFn,
): Promise<string | null> {
  const res = await fetchFn(`${baseUrl}/rest/api/3/field`, {
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Authentification JIRA refusée (HTTP ${res.status}) lors de la résolution des champs.`,
    );
  }
  if (!res.ok) return null;
  const fields: Array<{ id: string; name: string }> = await res.json();
  const match = fields.find((f) => f.name === 'Start date' || f.name === 'Date de début');
  return match?.id ?? null;
}

// ---------------------------------------------------------------------------
// fetchFullSnapshot
// ---------------------------------------------------------------------------

export async function fetchFullSnapshot(
  cfg: JiraConnConfig,
  fetchFn: FetchFn = fetch,
): Promise<JiraSnapshot> {
  const auth = 'Basic ' + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64');
  const startFieldId = await resolveStartDateField(cfg.baseUrl, auth, fetchFn);

  const allProjects = [...new Set([...cfg.projectKeys, cfg.riskProject])].filter(Boolean);
  if (!allProjects.length) {
    return {
      takenAt: new Date().toISOString(),
      baseUrl: cfg.baseUrl,
      projectKeys: allProjects,
      count: 0,
      issues: [],
    };
  }

  const baseFields = [
    'summary', 'description', 'status', 'assignee', 'issuetype', 'project',
    'parent', 'labels', 'duedate', 'timetracking', 'priority', 'issuelinks',
  ];
  const fields = startFieldId ? [...baseFields, startFieldId] : baseFields;
  const issues: RawIssue[] = [];
  let token: string | undefined;

  for (let guard = 0; guard < 50; guard++) {
    const body: Record<string, unknown> = {
      jql: `project IN (${allProjects.join(',')}) ORDER BY created ASC`,
      maxResults: 100,
      fields,
    };
    if (token) body.nextPageToken = token;

    const res = await fetchFn(`${cfg.baseUrl}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`JIRA ${res.status} : ${(await res.text()).slice(0, 200)}`);
    }

    const page: any = await res.json();
    for (const it of page.issues ?? []) {
      const f = it.fields ?? {};
      const rawDescription = f.description;
      let descText: string | null = null;
      if (rawDescription?.content) {
        descText = extractAdfText(rawDescription);
      } else if (typeof rawDescription === 'string') {
        descText = rawDescription;
      }
      const estimateSeconds: number | null = f.timetracking?.originalEstimateSeconds ?? null;
      const links: RawIssue['links'] = (f.issuelinks ?? []).map((l: any) => ({
        type: l.type?.name ?? '',
        inwardKey: l.inwardIssue?.key,
        outwardKey: l.outwardIssue?.key,
      }));
      issues.push({
        key: it.key,
        project: f.project?.key ?? '?',
        issuetype: f.issuetype?.name ?? '?',
        summary: f.summary ?? '',
        description: descText,
        status: f.status?.name ?? '?',
        assignee: f.assignee?.displayName ?? null,
        parentKey: f.parent?.key ?? null,
        labels: f.labels ?? [],
        start: startFieldId ? (f[startFieldId] ?? null) : null,
        due: f.duedate ?? null,
        estimateHours: estimateSeconds !== null ? estimateSeconds / 3600 : null,
        priority: f.priority?.name ?? null,
        links,
      });
    }
    token = page.nextPageToken;
    if (!token) break;
  }

  return {
    takenAt: new Date().toISOString(),
    baseUrl: cfg.baseUrl,
    projectKeys: allProjects,
    count: issues.length,
    issues,
  };
}

// ---------------------------------------------------------------------------
// summarizeSnapshot — PURE
// ---------------------------------------------------------------------------

export function summarizeSnapshot(snap: JiraSnapshot): string {
  const counts = new Map<string, number>();
  for (const issue of snap.issues) {
    counts.set(issue.project, (counts.get(issue.project) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([proj, n]) => `${proj}:${n}`);
  return `${snap.count} issues (${parts.join(', ')}) @ ${snap.takenAt}`;
}

// ---------------------------------------------------------------------------
// indexSnapshot — PURE
// ---------------------------------------------------------------------------

export function indexSnapshot(issues: RawIssue[]): SnapshotIndex {
  const nidToKey = new Map<string, string>();
  const keys = new Set<string>();
  const epics = new Set<string>();
  for (const i of issues) {
    keys.add(i.key);
    if (i.issuetype === 'Epic') epics.add(i.key);
    const nid = (i.labels || []).find((l) => l.startsWith('nid-'))?.slice(4);
    if (nid) nidToKey.set(nid, i.key);
  }
  return { nidToKey, keys, epics };
}
