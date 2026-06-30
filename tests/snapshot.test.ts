// tests/snapshot.test.ts
import { describe, it, expect } from 'vitest';
import {
  fetchFullSnapshot,
  summarizeSnapshot,
  indexSnapshot,
  type JiraSnapshot,
  type RawIssue,
} from '../src/snapshot.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeIssue(overrides: Partial<{
  key: string; project: string; summary: string; status: string;
  assignee: string | null; parentKey: string | null; labels: string[];
  due: string | null; start: string | null; estimateSeconds: number | null;
  priority: string | null; issuetype: string; description: any; issuelinks: any[];
}> = {}) {
  const {
    key = 'PROJ-1', project = 'PROJ', summary = 'Test issue', status = 'To Do',
    assignee = null, parentKey = null, labels = [], due = null, start = null,
    estimateSeconds = null, priority = null, issuetype = 'Task', description = null,
    issuelinks = [],
  } = overrides;
  return {
    key,
    fields: {
      project: { key: project },
      summary,
      description,
      status: { name: status },
      assignee: assignee ? { displayName: assignee } : null,
      parent: parentKey ? { key: parentKey } : null,
      labels,
      duedate: due,
      timetracking: estimateSeconds !== null ? { originalEstimateSeconds: estimateSeconds } : {},
      priority: priority ? { name: priority } : null,
      issuetype: { name: issuetype, subtask: issuetype === 'Sub-task' },
      issuelinks,
    },
  };
}

function makeFakeFetch(issues: any[], startDateFieldId: string | null = null): typeof fetch {
  const fieldList = [
    { id: 'summary', name: 'Summary' },
    { id: 'status', name: 'Status' },
    ...(startDateFieldId ? [{ id: startDateFieldId, name: 'Start date' }] : []),
  ];
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = url.toString();
    if (urlStr.includes('/rest/api/3/field')) {
      return new Response(JSON.stringify(fieldList), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (urlStr.includes('/rest/api/3/search/jql')) {
      return new Response(JSON.stringify({ issues, nextPageToken: undefined }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('Not Found', { status: 404 });
  };
}

const FAKE_CFG = {
  baseUrl: 'https://fake.atlassian.net',
  email: 'test@example.com',
  apiToken: 'fake-token',
  projectKeys: ['PROJ', 'OTHER'],
  riskProject: 'RISK',
};

// ---------------------------------------------------------------------------
// fetchFullSnapshot
// ---------------------------------------------------------------------------

describe('fetchFullSnapshot', () => {
  it('renvoie un snapshot avec les métadonnées correctes', async () => {
    const snap = await fetchFullSnapshot(FAKE_CFG, makeFakeFetch([makeFakeIssue({ key: 'PROJ-1', project: 'PROJ' })]));
    expect(snap.baseUrl).toBe('https://fake.atlassian.net');
    expect(snap.projectKeys).toContain('PROJ');
    expect(snap.projectKeys).toContain('RISK');
    expect(snap.count).toBe(1);
    expect(snap.takenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('mappe tous les champs RawIssue', async () => {
    const fakeIssues = [makeFakeIssue({
      key: 'PROJ-42', project: 'PROJ', summary: 'My summary', status: 'In Progress',
      assignee: 'Alice', parentKey: 'PROJ-10', labels: ['urgent', 'backend'],
      due: '2026-12-31', estimateSeconds: 7200, priority: 'High', issuetype: 'Story',
      issuelinks: [{ type: { name: 'Blocks' }, outwardIssue: { key: 'PROJ-99' } }],
    })];
    const snap = await fetchFullSnapshot(FAKE_CFG, makeFakeFetch(fakeIssues));
    const issue = snap.issues[0];
    expect(issue.key).toBe('PROJ-42');
    expect(issue.summary).toBe('My summary');
    expect(issue.status).toBe('In Progress');
    expect(issue.assignee).toBe('Alice');
    expect(issue.parentKey).toBe('PROJ-10');
    expect(issue.labels).toEqual(['urgent', 'backend']);
    expect(issue.due).toBe('2026-12-31');
    expect(issue.estimateHours).toBe(2);
    expect(issue.priority).toBe('High');
    expect(issue.issuetype).toBe('Story');
    expect(issue.links).toEqual([{ type: 'Blocks', inwardKey: undefined, outwardKey: 'PROJ-99' }]);
  });

  it('résout le champ start date personnalisé', async () => {
    const startFieldId = 'customfield_10015';
    const fakeIssues = [{
      key: 'PROJ-1',
      fields: {
        project: { key: 'PROJ' }, summary: 'With start date', description: null,
        status: { name: 'To Do' }, assignee: null, parent: null, labels: [],
        duedate: null, timetracking: {}, priority: null,
        issuetype: { name: 'Task', subtask: false }, issuelinks: [],
        [startFieldId]: '2026-01-15',
      },
    }];
    const snap = await fetchFullSnapshot(FAKE_CFG, makeFakeFetch(fakeIssues, startFieldId));
    expect(snap.issues[0].start).toBe('2026-01-15');
  });

  it('renvoie un snapshot vide quand aucun projet configuré', async () => {
    const cfg = { ...FAKE_CFG, projectKeys: [], riskProject: '' };
    const snap = await fetchFullSnapshot(cfg, makeFakeFetch([]));
    expect(snap.count).toBe(0);
    expect(snap.issues).toHaveLength(0);
  });

  it('déduplique les projets (riskProject déjà dans projectKeys)', async () => {
    const cfg = { ...FAKE_CFG, projectKeys: ['PROJ', 'RISK'], riskProject: 'RISK' };
    const capturedBodies: string[] = [];
    const spyFetch: typeof fetch = async (url, init) => {
      const urlStr = url.toString();
      if (urlStr.includes('/rest/api/3/field')) return new Response(JSON.stringify([]), { status: 200 });
      if (init?.body) capturedBodies.push(init.body as string);
      return new Response(JSON.stringify({ issues: [] }), { status: 200 });
    };
    await fetchFullSnapshot(cfg, spyFetch);
    const jql: string = JSON.parse(capturedBodies[0]).jql;
    expect((jql.match(/RISK/g) ?? []).length).toBe(1);
  });

  it('lève une erreur sur HTTP error de JIRA', async () => {
    const errFetch: typeof fetch = async (url) => {
      if (url.toString().includes('/rest/api/3/field')) return new Response(JSON.stringify([]), { status: 200 });
      return new Response('Unauthorized', { status: 401 });
    };
    await expect(fetchFullSnapshot(FAKE_CFG, errFetch)).rejects.toThrow('JIRA 401');
  });

  it('extrait le texte brut depuis une description ADF (pas de \\n après paragraphe)', async () => {
    const adf = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }] }],
    };
    const snap = await fetchFullSnapshot(FAKE_CFG, makeFakeFetch([makeFakeIssue({ description: adf })]));
    expect(snap.issues[0].description).toBe('Hello world');
  });
});

// ---------------------------------------------------------------------------
// summarizeSnapshot
// ---------------------------------------------------------------------------

describe('summarizeSnapshot', () => {
  it('renvoie un résumé avec le compte par projet', () => {
    const snap: JiraSnapshot = {
      takenAt: '2026-06-11T10:00:00.000Z',
      baseUrl: 'https://fake.atlassian.net',
      projectKeys: ['PROJ', 'OTHER'],
      count: 3,
      issues: [
        { key: 'PROJ-1', project: 'PROJ' } as RawIssue,
        { key: 'PROJ-2', project: 'PROJ' } as RawIssue,
        { key: 'OTHER-1', project: 'OTHER' } as RawIssue,
      ],
    };
    const summary = summarizeSnapshot(snap);
    expect(summary).toContain('3 issues');
    expect(summary).toContain('OTHER:1');
    expect(summary).toContain('PROJ:2');
    expect(summary).toContain('2026-06-11T10:00:00.000Z');
  });

  it('trie les projets alphabétiquement', () => {
    const snap: JiraSnapshot = {
      takenAt: '2026-06-11T10:00:00.000Z',
      baseUrl: 'https://x',
      projectKeys: ['ZETA', 'ALPHA'],
      count: 2,
      issues: [
        { key: 'ZETA-1', project: 'ZETA' } as RawIssue,
        { key: 'ALPHA-1', project: 'ALPHA' } as RawIssue,
      ],
    };
    const summary = summarizeSnapshot(snap);
    expect(summary.indexOf('ALPHA')).toBeLessThan(summary.indexOf('ZETA'));
  });
});

// ---------------------------------------------------------------------------
// indexSnapshot
// ---------------------------------------------------------------------------

function issRaw(p: Partial<RawIssue> & { key: string }): RawIssue {
  return {
    key: p.key, project: p.project ?? 'GES', issuetype: p.issuetype ?? 'Tâche',
    summary: p.summary ?? '', description: null, status: p.status ?? 'À faire',
    assignee: null, parentKey: null, labels: p.labels ?? [], start: null, due: null,
    estimateHours: null, priority: null, links: [],
  };
}

describe('indexSnapshot', () => {
  it('mappe nid-<ID> → clé, collecte clés et epics', () => {
    const idx = indexSnapshot([
      issRaw({ key: 'GES-66', issuetype: 'Epic' }),
      issRaw({ key: 'LIVS-75', issuetype: 'Epic', project: 'LIVS' }),
      issRaw({ key: 'GES-80', labels: ['nid-SARIC-05'] }),
      issRaw({ key: 'GES-90', labels: ['autre', 'nid-COM-02'] }),
      issRaw({ key: 'GES-3' }),
    ]);
    expect(idx.nidToKey.get('SARIC-05')).toBe('GES-80');
    expect(idx.nidToKey.get('COM-02')).toBe('GES-90');
    expect(idx.nidToKey.has('GES-3')).toBe(false);
    expect(idx.keys.has('GES-3')).toBe(true);
    expect(idx.keys.size).toBe(5);
    expect(idx.epics.has('GES-66')).toBe(true);
    expect(idx.epics.has('GES-80')).toBe(false);
    expect(idx.epics.size).toBe(2);
  });

  it('ne prend que le premier label nid- d\'une issue', () => {
    const idx = indexSnapshot([issRaw({ key: 'X-1', labels: ['nid-A', 'nid-B'] })]);
    expect(idx.nidToKey.get('A')).toBe('X-1');
    expect(idx.nidToKey.has('B')).toBe(false);
  });

  it('gère un snapshot vide', () => {
    const idx = indexSnapshot([]);
    expect(idx.nidToKey.size).toBe(0);
    expect(idx.keys.size).toBe(0);
    expect(idx.epics.size).toBe(0);
  });
});
