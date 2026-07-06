import { describe, it, expect, vi } from 'vitest';
import { JiraClient } from '../src/jira-client.js';
import type { Config } from '../src/types.js';

const cfg: Config = { baseUrl: 'https://x.atlassian.net', email: 'a@b.c',
  apiToken: 'tok', projectKey: 'NATHAN', issueType: 'Task' };

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe('JiraClient.init', () => {
  it('résout le champ « Start date » (EN)', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes([
      { id: 'customfield_10099', name: 'Autre' },
      { id: 'customfield_10015', name: 'Start date' },
    ]));
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch);
    await client.init();
    expect(client.getStartField()).toBe('customfield_10015');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://x.atlassian.net/rest/api/3/field',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringContaining('Basic ') }) }),
    );
  });

  it('résout le champ « Date de début » (FR) en plus de « Start date »', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes([
      { id: 'customfield_99999', name: 'Autre' },
      { id: 'customfield_10020', name: 'Date de début' },
    ]));
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch);
    await client.init();
    expect(client.getStartField()).toBe('customfield_10020');
  });

  it('renvoie null si aucun champ de date de début n\'est trouvé', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes([{ id: 'customfield_1', name: 'Autre' }]));
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch);
    await client.init();
    expect(client.getStartField()).toBeNull();
  });

  it('lève une erreur HTTP explicite si /field échoue', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes({ message: 'nope' }, false, 500));
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch);
    await expect(client.init()).rejects.toThrow('JIRA GET /rest/api/3/field -> 500');
  });
});

describe('JiraClient : chemin mort nid retiré', () => {
  it('n\'expose plus les méthodes du chemin nid (fetchNathanIssues, fetchPlanData, createIssue, updateIssue, linkBlocks)', () => {
    const client = new JiraClient(cfg, vi.fn() as unknown as typeof fetch);
    expect((client as any).fetchNathanIssues).toBeUndefined();
    expect((client as any).fetchPlanData).toBeUndefined();
    expect((client as any).createIssue).toBeUndefined();
    expect((client as any).updateIssue).toBeUndefined();
    expect((client as any).linkBlocks).toBeUndefined();
  });
});
