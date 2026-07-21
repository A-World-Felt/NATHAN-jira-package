/**
 * jira-write.test.ts — TDD des primitives génériques d'écriture JIRA.
 *
 * SÛRETÉ : AUCUN appel JIRA réel. Tout passe par un fetch MOCKÉ.
 */

import { describe, it, expect } from 'vitest';
import {
  isRealJiraKey,
  hoursToJiraDuration,
  createEpic,
  createTask,
  transitionTo,
  linkDep,
  restructureOriginal,
  deleteIssue,
  carryStatusThenDelete,
  createRisk,
  type JiraWriteClient,
} from '../src/jira-write.js';

// ---------------------------------------------------------------------------
// Fake client avec routes + journal d'appels
// ---------------------------------------------------------------------------

type FakeRoute = {
  method?: string;
  urlPart: string;
  status: number;
  body: unknown;
};

interface Call {
  method: string;
  url: string;
  body: any;
}

function makeFakeClient(
  routes: FakeRoute[],
  startFieldId: string | null = 'customfield_10015',
): JiraWriteClient & { calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    let parsedBody: any;
    if (init?.body && typeof init.body === 'string') {
      try { parsedBody = JSON.parse(init.body); } catch { parsedBody = init.body; }
    }
    calls.push({ method, url, body: parsedBody });
    for (const route of routes) {
      const routeMethod = (route.method ?? 'POST').toUpperCase();
      if (routeMethod === method && url.includes(route.urlPart)) {
        return new Response(
          typeof route.body === 'string' ? route.body : JSON.stringify(route.body),
          { status: route.status },
        );
      }
    }
    return new Response(JSON.stringify({ error: `No route ${method} ${url}` }), { status: 404 });
  };
  return { baseUrl: 'https://fake.atlassian.net', authHeader: 'Basic fake=', startFieldId, fetchFn, calls };
}

// ---------------------------------------------------------------------------
// hoursToJiraDuration — conversion pure heures → durée JIRA (unités entières)
// ---------------------------------------------------------------------------

describe('hoursToJiraDuration', () => {
  it('heure entière → "Xh"', () => {
    expect(hoursToJiraDuration(3)).toBe('3h');
  });
  it('demi-heure seule → "30m" (jamais de décimale)', () => {
    expect(hoursToJiraDuration(0.5)).toBe('30m');
  });
  it('heures + demi-heure composées → "Xh 30m"', () => {
    expect(hoursToJiraDuration(2.5)).toBe('2h 30m');
    expect(hoursToJiraDuration(10.5)).toBe('10h 30m');
  });
  it('quart d\'heure → minutes exactes', () => {
    expect(hoursToJiraDuration(1.25)).toBe('1h 15m');
  });
  it('ne produit jamais de point décimal dans la sortie', () => {
    expect(hoursToJiraDuration(0.5)).not.toMatch(/\./);
    expect(hoursToJiraDuration(10.5)).not.toMatch(/\./);
  });
});

// ---------------------------------------------------------------------------
// isRealJiraKey
// ---------------------------------------------------------------------------

describe('isRealJiraKey', () => {
  it('reconnaît une clé réelle', () => {
    expect(isRealJiraKey('LIVS-32')).toBe(true);
    expect(isRealJiraKey('DC-1')).toBe(true);
  });
  it('rejette les key_temp', () => {
    expect(isRealJiraKey('LIVS-MIP')).toBe(false);
    expect(isRealJiraKey('GES-PROCESS')).toBe(false);
    expect(isRealJiraKey('RISK-REG')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createEpic
// ---------------------------------------------------------------------------

describe('createEpic', () => {
  it('POST /issue avec issuetype Epic et renvoie la clé', async () => {
    const client = makeFakeClient([
      { method: 'POST', urlPart: 'rest/api/3/issue', status: 201, body: { key: 'LIVS-100' } },
    ]);
    const key = await createEpic(client, 'LIVS', 'MIP — Mémoire');
    expect(key).toBe('LIVS-100');
    const body = client.calls[0].body;
    expect(body.fields.issuetype.name).toBe('Epic');
    expect(body.fields.project.key).toBe('LIVS');
    expect(body.fields.summary).toBe('MIP — Mémoire');
  });
  it('lève sur HTTP 400', async () => {
    const client = makeFakeClient([
      { method: 'POST', urlPart: 'rest/api/3/issue', status: 400, body: { errorMessages: ['bad'] } },
    ]);
    await expect(createEpic(client, 'LIVS', 'X')).rejects.toThrow(/400/);
  });
});

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

describe('createTask', () => {
  it('POST /issue Task avec parent=epicKey, duedate, start, labels', async () => {
    const client = makeFakeClient([
      { method: 'POST', urlPart: 'rest/api/3/issue', status: 201, body: { key: 'LIVS-200' } },
    ]);
    const key = await createTask(
      client, 'LIVS', 'Analyse', 'LIVS-100', '2026-06-08', '2026-06-11', ['nid-MIP-02'],
    );
    expect(key).toBe('LIVS-200');
    const f = client.calls[0].body.fields;
    expect(f.issuetype.name).toBe('Task');
    expect(f.parent.key).toBe('LIVS-100');
    expect(f.duedate).toBe('2026-06-11');
    expect(f['customfield_10015']).toBe('2026-06-08');
    expect(f.labels).toContain('nid-MIP-02');
  });

  it('ne pose PAS le champ start si startFieldId est null', async () => {
    const client = makeFakeClient(
      [{ method: 'POST', urlPart: 'rest/api/3/issue', status: 201, body: { key: 'LIVS-201' } }],
      null,
    );
    await createTask(client, 'LIVS', 'X', 'LIVS-100', '2026-06-08', null, []);
    const f = client.calls[0].body.fields;
    expect(f.customfield_10015).toBeUndefined();
  });

  it('ne pose JAMAIS timetracking (time-tracking off)', async () => {
    const client = makeFakeClient([
      { method: 'POST', urlPart: 'rest/api/3/issue', status: 201, body: { key: 'LIVS-202' } },
    ]);
    await createTask(client, 'LIVS', 'X', 'LIVS-100', null, null, []);
    expect(client.calls[0].body.fields.timetracking).toBeUndefined();
  });

  it('lève sur HTTP 400', async () => {
    const client = makeFakeClient([
      { method: 'POST', urlPart: 'rest/api/3/issue', status: 400, body: { errorMessages: ['bad'] } },
    ]);
    await expect(createTask(client, 'LIVS', 'X', 'LIVS-100', null, null, [])).rejects.toThrow(/400/);
  });
});

// ---------------------------------------------------------------------------
// transitionTo
// ---------------------------------------------------------------------------

describe('transitionTo', () => {
  it('résout le statut courant via GET ?fields=status puis POST la transition cible', async () => {
    const client = makeFakeClient([
      {
        method: 'GET', urlPart: 'issue/DC-5?fields=status', status: 200,
        body: { fields: { status: { name: 'À faire' } } },
      },
      {
        method: 'GET', urlPart: '/transitions', status: 200,
        body: { transitions: [
          { id: '11', to: { name: 'À faire' } },
          { id: '21', to: { name: 'PCB - À faire' } },
        ] },
      },
      { method: 'POST', urlPart: '/transitions', status: 204, body: '' },
    ]);
    const moved = await transitionTo(client, 'DC-5', 'PCB - À faire');
    expect(moved).toBe(true);
    expect(client.calls.some((c) => c.method === 'GET' && c.url.includes('issue/DC-5?fields=status'))).toBe(true);
    const post = client.calls.find((c) => c.method === 'POST')!;
    expect(post.body.transition.id).toBe('21');
  });

  it('succès silencieux (false) si le statut courant est DÉJÀ la cible', async () => {
    const client = makeFakeClient([
      {
        method: 'GET', urlPart: 'issue/LIVS-20?fields=status', status: 200,
        body: { fields: { status: { name: 'En cours' } } },
      },
    ]);
    const moved = await transitionTo(client, 'LIVS-20', 'En cours');
    expect(moved).toBe(false);
    expect(client.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(client.calls.some((c) => c.method === 'GET' && c.url.includes('/transitions'))).toBe(false);
  });

  it('lève si la transition cible est introuvable (statut courant différent)', async () => {
    const client = makeFakeClient([
      {
        method: 'GET', urlPart: 'issue/LIVS-1?fields=status', status: 200,
        body: { fields: { status: { name: 'À faire' } } },
      },
      {
        method: 'GET', urlPart: '/transitions', status: 200,
        body: { transitions: [{ id: '11', to: { name: 'À faire' } }] },
      },
    ]);
    await expect(transitionTo(client, 'LIVS-1', 'Statut Inexistant')).rejects.toThrow(/introuvable/);
  });
});

// ---------------------------------------------------------------------------
// linkDep — FS→Blocks, SS→Relates
// ---------------------------------------------------------------------------

describe('linkDep', () => {
  it('FS → lien Blocks (prereq BLOCKS task) — inwardIssue=prereq (sens JIRA réel)', async () => {
    const client = makeFakeClient([
      { method: 'POST', urlPart: 'rest/api/3/issueLink', status: 201, body: '' },
    ]);
    await linkDep(client, 'LIVS-10', 'LIVS-20', 'FS');
    const b = client.calls[0].body;
    expect(b.type.name).toBe('Blocks');
    expect(b.inwardIssue.key).toBe('LIVS-10');
    expect(b.outwardIssue.key).toBe('LIVS-20');
  });

  it('SS → lien Relates (non bloquant)', async () => {
    const client = makeFakeClient([
      { method: 'POST', urlPart: 'rest/api/3/issueLink', status: 201, body: '' },
    ]);
    await linkDep(client, 'LIVS-10', 'LIVS-20', 'SS');
    expect(client.calls[0].body.type.name).toBe('Relates');
  });

  it('lève sur HTTP 400', async () => {
    const client = makeFakeClient([
      { method: 'POST', urlPart: 'rest/api/3/issueLink', status: 400, body: { errorMessages: ['x'] } },
    ]);
    await expect(linkDep(client, 'A-1', 'A-2', 'FS')).rejects.toThrow(/400/);
  });
});

// ---------------------------------------------------------------------------
// restructureOriginal — garde le statut, pose parent+dates
// ---------------------------------------------------------------------------

describe('restructureOriginal', () => {
  it('PUT /issue/{key} avec parent et dates, sans toucher au statut', async () => {
    const client = makeFakeClient([
      { method: 'PUT', urlPart: 'rest/api/3/issue/LIVS-1', status: 204, body: '' },
    ]);
    await restructureOriginal(client, 'LIVS-1', 'LIVS-EVAL', '2026-05-18', '2026-05-21');
    const call = client.calls[0];
    expect(call.method).toBe('PUT');
    expect(call.url).toContain('LIVS-1');
    const f = call.body.fields;
    expect(f.parent.key).toBe('LIVS-EVAL');
    expect(f.duedate).toBe('2026-05-21');
    expect(f['customfield_10015']).toBe('2026-05-18');
    expect(f.status).toBeUndefined();
  });

  it('omet les dates nulles', async () => {
    const client = makeFakeClient([
      { method: 'PUT', urlPart: 'rest/api/3/issue/RISK-1', status: 204, body: '' },
    ]);
    await restructureOriginal(client, 'RISK-1', 'RISK-REG', null, null);
    const f = client.calls[0].body.fields;
    expect(f.duedate).toBeUndefined();
    expect(f.customfield_10015).toBeUndefined();
    expect(f.parent.key).toBe('RISK-REG');
  });
});

// ---------------------------------------------------------------------------
// deleteIssue
// ---------------------------------------------------------------------------

describe('deleteIssue', () => {
  it('DELETE /issue/{key}?deleteSubtasks=true', async () => {
    const client = makeFakeClient([
      { method: 'DELETE', urlPart: 'rest/api/3/issue/DC-1', status: 204, body: '' },
    ]);
    await deleteIssue(client, 'DC-1');
    const call = client.calls[0];
    expect(call.method).toBe('DELETE');
    expect(call.url).toContain('deleteSubtasks=true');
  });
  it('lève sur HTTP 400', async () => {
    const client = makeFakeClient([
      { method: 'DELETE', urlPart: 'rest/api/3/issue/DC-1', status: 400, body: { e: 1 } },
    ]);
    await expect(deleteIssue(client, 'DC-1')).rejects.toThrow(/400/);
  });
});

// ---------------------------------------------------------------------------
// carryStatusThenDelete — report PUIS suppression
// ---------------------------------------------------------------------------

describe('carryStatusThenDelete', () => {
  it('transitionne le jumeau PUIS supprime (dans cet ordre)', async () => {
    const client = makeFakeClient([
      {
        method: 'GET', urlPart: 'issue/LIVS-26?fields=status', status: 200,
        body: { fields: { status: { name: 'À faire' } } },
      },
      {
        method: 'GET', urlPart: 'LIVS-26/transitions', status: 200,
        body: { transitions: [{ id: '41', to: { name: 'Revision' } }] },
      },
      { method: 'POST', urlPart: 'LIVS-26/transitions', status: 204, body: '' },
      { method: 'DELETE', urlPart: 'rest/api/3/issue/LIVS-3', status: 204, body: '' },
    ]);
    await carryStatusThenDelete(client, 'LIVS-3', 'LIVS-26', 'Revision');
    const delIdx = client.calls.findIndex((c) => c.method === 'DELETE');
    const postIdx = client.calls.findIndex((c) => c.method === 'POST');
    expect(postIdx).toBeGreaterThanOrEqual(0);
    expect(delIdx).toBeGreaterThan(postIdx);
    expect(client.calls[delIdx].url).toContain('LIVS-3');
  });
});

// ---------------------------------------------------------------------------
// createRisk
// ---------------------------------------------------------------------------

describe('createRisk', () => {
  it('POST /issue dans RISK avec labels bloc- et description sévérité/mitigation', async () => {
    const client = makeFakeClient([
      { method: 'POST', urlPart: 'rest/api/3/issue', status: 201, body: { key: 'RISK-50' } },
    ]);
    const key = await createRisk(client, 'RISK', 'HRTF sur MCU', 'Critique', 'Filtres courts', ['bloc-audio']);
    expect(key).toBe('RISK-50');
    const f = client.calls[0].body.fields;
    expect(f.project.key).toBe('RISK');
    expect(f.summary).toBe('HRTF sur MCU');
    expect(f.labels).toContain('bloc-audio');
    const txt = JSON.stringify(f.description);
    expect(txt).toContain('Critique');
    expect(txt).toContain('Filtres courts');
  });
});

// ---------------------------------------------------------------------------
// createSubtask
// ---------------------------------------------------------------------------

import { createSubtask } from '../src/jira-write.js';

describe('createSubtask', () => {
  it('crée une Sous-tâche avec parent et labels (HTTP 201)', async () => {
    const client = makeFakeClient([
      { method: 'POST', urlPart: '/issue', status: 201, body: { key: 'GES-42' } },
    ]);
    const key = await createSubtask(client, 'GES', 'Ordre du jour', 'GES-10', {
      start: '2026-06-01',
      due: '2026-06-15',
      labels: ['nid-SEC-s8-1'],
    });
    expect(key).toBe('GES-42');
    const call = client.calls[0];
    expect(call.body.fields.issuetype.name).toBe('Sous-tâche');
    expect(call.body.fields.parent.key).toBe('GES-10');
    expect(call.body.fields.labels).toContain('nid-SEC-s8-1');
  });

  it('throws on HTTP 400', async () => {
    const client = makeFakeClient([
      { method: 'POST', urlPart: '/issue', status: 400, body: 'Bad Request' },
    ]);
    await expect(
      createSubtask(client, 'GES', 'X', 'GES-10', {}),
    ).rejects.toThrow('HTTP 400');
  });
});

// ---------------------------------------------------------------------------
// resolveAccountId — nom d'affichage → accountId (cache + erreurs explicites)
// ---------------------------------------------------------------------------

import { resolveAccountId } from '../src/jira-write.js';

function makeUserSearchClient(
  responses: Record<string, Array<{ accountId: string; displayName: string; accountType: string; active: boolean }>>,
): JiraWriteClient & { calls: string[] } {
  const calls: string[] = [];
  const fetchFn: typeof fetch = async (input) => {
    const url = input.toString();
    calls.push(url);
    const q = new URL(url).searchParams.get('query') ?? '';
    const body = responses[q] ?? [];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { baseUrl: 'https://fake.atlassian.net', authHeader: 'Basic fake=', startFieldId: null, fetchFn, calls };
}

describe('resolveAccountId', () => {
  it('renvoie l\'accountId sur correspondance unique', async () => {
    const client = makeUserSearchClient({
      'Arthur-Olivier Fortin': [
        { accountId: '712020:abc', displayName: 'Arthur-Olivier Fortin', accountType: 'atlassian', active: true },
      ],
    });
    const id = await resolveAccountId(client, 'Arthur-Olivier Fortin');
    expect(id).toBe('712020:abc');
  });

  it('exclut les comptes non-humains (accountType app/bot)', async () => {
    const client = makeUserSearchClient({
      'Mathieu Nicol': [
        { accountId: 'app-1', displayName: 'Mathieu Nicol Bot', accountType: 'app', active: true },
        { accountId: '712020:xyz', displayName: 'Mathieu Nicol', accountType: 'atlassian', active: true },
      ],
    });
    const id = await resolveAccountId(client, 'Mathieu Nicol');
    expect(id).toBe('712020:xyz');
  });

  it('lève une erreur explicite si 0 correspondance (introuvable)', async () => {
    const client = makeUserSearchClient({ 'Nom Inconnu': [] });
    await expect(resolveAccountId(client, 'Nom Inconnu')).rejects.toThrow(/introuvable/);
  });

  it('lève une erreur explicite si plusieurs correspondances (ambigu)', async () => {
    const client = makeUserSearchClient({
      'Alex Roy': [
        { accountId: 'a1', displayName: 'Alex Roy', accountType: 'atlassian', active: true },
        { accountId: 'a2', displayName: 'Alex Roy', accountType: 'atlassian', active: true },
      ],
    });
    await expect(resolveAccountId(client, 'Alex Roy')).rejects.toThrow(/ambigu/);
  });

  it('met en cache : un seul appel réseau pour deux résolutions du même nom', async () => {
    const client = makeUserSearchClient({
      'Arthur-Olivier Fortin': [
        { accountId: '712020:abc', displayName: 'Arthur-Olivier Fortin', accountType: 'atlassian', active: true },
      ],
    });
    const cache = new Map<string, string>();
    await resolveAccountId(client, 'Arthur-Olivier Fortin', cache);
    await resolveAccountId(client, 'Arthur-Olivier Fortin', cache);
    expect(client.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// setAssignee — PUT assignee (accountId ou null pour désassigner)
// ---------------------------------------------------------------------------

import { setAssignee, setEstimate } from '../src/jira-write.js';

describe('setAssignee', () => {
  it('PUT fields.assignee.accountId quand accountId fourni', async () => {
    const client = makeFakeClient([
      { method: 'PUT', urlPart: 'rest/api/3/issue/DEV-191', status: 204, body: '' },
    ]);
    await setAssignee(client, 'DEV-191', '712020:abc');
    const f = client.calls[0].body.fields;
    expect(f.assignee).toEqual({ accountId: '712020:abc' });
  });

  it('PUT fields.assignee = null quand accountId === null (désassigne)', async () => {
    const client = makeFakeClient([
      { method: 'PUT', urlPart: 'rest/api/3/issue/DEV-197', status: 204, body: '' },
    ]);
    await setAssignee(client, 'DEV-197', null);
    const f = client.calls[0].body.fields;
    expect(f.assignee).toBeNull();
  });

  it('lève sur HTTP 400', async () => {
    const client = makeFakeClient([
      { method: 'PUT', urlPart: 'rest/api/3/issue/DEV-1', status: 400, body: { errorMessages: ['bad'] } },
    ]);
    await expect(setAssignee(client, 'DEV-1', '712020:abc')).rejects.toThrow(/400/);
  });
});

// ---------------------------------------------------------------------------
// setEstimate — PUT timetracking.originalEstimate (unités entières)
// ---------------------------------------------------------------------------

describe('setEstimate', () => {
  it('PUT timetracking.originalEstimate au format entier composé', async () => {
    const client = makeFakeClient([
      { method: 'PUT', urlPart: 'rest/api/3/issue/DEV-195', status: 204, body: '' },
    ]);
    await setEstimate(client, 'DEV-195', 10.5);
    const f = client.calls[0].body.fields;
    expect(f.timetracking).toEqual({ originalEstimate: '10h 30m' });
  });

  it('demi-heure seule → "30m"', async () => {
    const client = makeFakeClient([
      { method: 'PUT', urlPart: 'rest/api/3/issue/DEV-196', status: 204, body: '' },
    ]);
    await setEstimate(client, 'DEV-196', 0.5);
    expect(client.calls[0].body.fields.timetracking).toEqual({ originalEstimate: '30m' });
  });

  it('hours === null → efface l\'estimation (timetracking: {})', async () => {
    const client = makeFakeClient([
      { method: 'PUT', urlPart: 'rest/api/3/issue/DEV-1', status: 204, body: '' },
    ]);
    await setEstimate(client, 'DEV-1', null);
    expect(client.calls[0].body.fields.timetracking).toEqual({});
  });

  it('lève sur HTTP 400', async () => {
    const client = makeFakeClient([
      { method: 'PUT', urlPart: 'rest/api/3/issue/DEV-1', status: 400, body: { errorMessages: ['bad'] } },
    ]);
    await expect(setEstimate(client, 'DEV-1', 3)).rejects.toThrow(/400/);
  });
});
