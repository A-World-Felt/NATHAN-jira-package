import { describe, it, expect, vi } from 'vitest';
import { JiraClient } from '../src/jira-client.js';
import type { Config } from '../src/types.js';

const cfg: Config = { baseUrl: 'https://x.atlassian.net', email: 'a@b.c',
  apiToken: 'tok', projectKey: 'NATHAN', issueType: 'Task' };

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe('JiraClient.fetchNathanIssues', () => {
  it('résout le champ Start date, filtre les nid- et mappe les dépendances', async () => {
    const fetchFn = vi.fn()
      // 1) /rest/api/3/field
      .mockResolvedValueOnce(jsonRes([{ id: 'customfield_10015', name: 'Start date' }]))
      // 2) /rest/api/3/search/jql (1 page)
      .mockResolvedValueOnce(jsonRes({
        issues: [
          { key: 'NATHAN-1', fields: { summary: 'Tâche A', status: { name: 'En cours' },
            labels: ['nid-A-01', 'role-ENG'], duedate: '2026-07-10', customfield_10015: '2026-06-29',
            timetracking: { originalEstimateSeconds: 43200 }, issuelinks: [], description: null } },
          { key: 'NATHAN-2', fields: { summary: 'Tâche B', status: { name: 'À Faire' },
            labels: ['nid-A-02', 'role-AUD'], duedate: null, customfield_10015: null,
            timetracking: {}, description: null,
            issuelinks: [{ type: { name: 'Blocks' }, inwardIssue: { key: 'NATHAN-1' } }] } },
          { key: 'NATHAN-9', fields: { summary: 'Hors périmètre', status: { name: 'À Faire' },
            labels: ['autre'], issuelinks: [] } },
        ],
      }));
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch);
    await client.init();
    const tasks = await client.fetchNathanIssues();

    expect(tasks.map((t) => t.id)).toEqual(['A-01', 'A-02']); // NATHAN-9 filtré
    const a1 = tasks[0];
    expect(a1).toMatchObject({ jiraKey: 'NATHAN-1', title: 'Tâche A', role: 'ENG',
      start: '2026-06-29', due: '2026-07-10', estimateHours: 12,
      status: 'En cours', statusCategory: 'in_progress' });
    expect(tasks[1].dependsOn).toEqual(['A-01']); // B est bloquée par A-01
  });
});

describe('JiraClient.fetchPlanData', () => {
  it('retourne les tâches nid- et la liste légère de toutes les issues', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonRes([{ id: 'customfield_10015', name: 'Start date' }]))
      .mockResolvedValueOnce(jsonRes({
        issues: [
          { key: 'NATHAN-1', fields: { summary: 'Tâche A', status: { name: 'À Faire' },
            labels: ['nid-A-01', 'role-ENG'], issuelinks: [] } },
          { key: 'NATHAN-9', fields: { summary: 'Manuelle', status: { name: 'À Faire' },
            labels: [], issuelinks: [] } },
        ],
      }));
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch);
    await client.init();
    const { tasks, all } = await client.fetchPlanData();
    expect(tasks.map((t) => t.id)).toEqual(['A-01']);
    expect(all.map((a) => a.key)).toEqual(['NATHAN-1', 'NATHAN-9']);
    expect(all.find((a) => a.key === 'NATHAN-9')).toEqual({ key: 'NATHAN-9', summary: 'Manuelle', labels: [] });
  });
});

describe('JiraClient.init (champ date)', () => {
  it('résout le champ « Date de début » (FR) en plus de « Start date »', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes([
      { id: 'customfield_99999', name: 'Autre' },
      { id: 'customfield_10020', name: 'Date de début' },
    ]));
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch);
    await client.init();
    expect(client.getStartField()).toBe('customfield_10020');
  });
});

describe('JiraClient.createIssue', () => {
  it('POST avec labels, dates et estimation', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes({ key: 'NATHAN-50' }));
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch);
    // startField résolu manuellement pour ce test
    (client as unknown as { startField: string }).startField = 'customfield_10015';
    const key = await client.createIssue({ id: 'A-01', jiraKey: null, title: 'T', role: 'ENG',
      block: '', estimateHours: 12, start: '2026-06-29', due: '2026-07-10', session: null,
      dependsOn: [], status: '', statusCategory: 'todo', notes: 'note', url: null });
    expect(key).toBe('NATHAN-50');
    const [, init] = fetchFn.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.fields.labels).toContain('nid-A-01');
    expect(body.fields.labels).toContain('role-ENG');
    expect(body.fields.duedate).toBe('2026-07-10');
    expect(body.fields.customfield_10015).toBe('2026-06-29');
    expect(body.fields.timetracking).toEqual({ originalEstimate: '12h' });
  });
});
