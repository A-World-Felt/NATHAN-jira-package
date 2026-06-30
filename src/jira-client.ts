import type { Config, Task, StatusCategory } from './types.js';
import { statusInfo } from './mapping.js';
import { textToAdf, adfToText } from './adf.js';

type FetchFn = typeof fetch;

interface RawIssue {
  key: string;
  fields: Record<string, any> & {
    summary?: string;
    status?: { name: string };
    labels?: string[];
    duedate?: string | null;
    timetracking?: { originalEstimateSeconds?: number };
    issuelinks?: any[];
    description?: any;
  };
}

export interface SeedClient {
  createIssue(t: Task): Promise<string>;
  updateIssue(key: string, t: Task): Promise<void>;
  linkBlocks(blockerKey: string, blockedKey: string): Promise<void>;
}

function roleLabel(role: string): string {
  return `role-${(role || 'NA').replace(/\s+/g, '_')}`;
}

export class JiraClient implements SeedClient {
  private auth: string;
  private startField: string | null = null;

  constructor(private cfg: Config, private fetchFn: FetchFn = fetch) {
    this.auth = 'Basic ' + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64');
  }

  private async api(path: string, init: RequestInit = {}): Promise<any> {
    const res = await this.fetchFn(`${this.cfg.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.auth,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`JIRA ${init.method || 'GET'} ${path} -> ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.status === 204 ? null : res.json();
  }

  async init(): Promise<void> {
    const fields = await this.api('/rest/api/3/field');
    const startNames = ['Start date', 'Date de début'];
    const sd = (fields as any[]).find((f) => startNames.includes(f.name));
    this.startField = sd ? sd.id : null;
  }
  getStartField(): string | null { return this.startField; }

  private async searchAllRaw(): Promise<RawIssue[]> {
    const wanted = ['summary', 'description', 'status', 'labels', 'duedate', 'timetracking', 'issuelinks'];
    if (this.startField) wanted.push(this.startField);
    const all: RawIssue[] = [];
    let token: string | undefined;
    do {
      const body: any = {
        jql: `project = "${this.cfg.projectKey}" ORDER BY created ASC`,
        maxResults: 100,
        fields: wanted,
      };
      if (token) body.nextPageToken = token;
      const page = await this.api('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify(body) });
      all.push(...((page.issues as RawIssue[]) || []));
      token = page.nextPageToken;
    } while (token);
    return all;
  }

  private mapNathan(raw: RawIssue[]): Task[] {
    const nathan = raw.filter((it) => (it.fields.labels || []).some((l) => l.startsWith('nid-')));
    const keyToNid = new Map<string, string>();
    for (const it of nathan) {
      const nid = (it.fields.labels || []).find((l) => l.startsWith('nid-'))!.slice(4);
      keyToNid.set(it.key, nid);
    }
    return nathan.map((it) => this.toTask(it, keyToNid));
  }

  async fetchNathanIssues(): Promise<Task[]> {
    return this.mapNathan(await this.searchAllRaw());
  }

  async fetchPlanData(): Promise<{ tasks: Task[]; all: Array<{ key: string; summary: string; labels: string[] }> }> {
    const raw = await this.searchAllRaw();
    const tasks = this.mapNathan(raw);
    const all = raw.map((it) => ({ key: it.key, summary: it.fields.summary ?? '', labels: it.fields.labels ?? [] }));
    return { tasks, all };
  }

  private toTask(it: RawIssue, keyToNid: Map<string, string>): Task {
    const f = it.fields;
    const labels = f.labels || [];
    const id = labels.find((l) => l.startsWith('nid-'))!.slice(4);
    const roleLbl = labels.find((l) => l.startsWith('role-'));
    const cancelled = labels.includes('cancelled');
    const statusName = f.status?.name ?? '';
    const category: StatusCategory = cancelled ? 'cancelled' : statusInfo(statusName).category;
    const estSec = f.timetracking?.originalEstimateSeconds ?? null;
    const dependsOn = (f.issuelinks || [])
      .filter((l: any) => l.type?.name === 'Blocks' && l.inwardIssue)
      .map((l: any) => keyToNid.get(l.inwardIssue.key))
      .filter((x: any): x is string => !!x);
    return {
      id,
      jiraKey: it.key,
      title: f.summary ?? '',
      role: roleLbl ? roleLbl.slice(5).replace(/_/g, ' ') : '',
      block: '',
      estimateHours: estSec != null ? Math.round((estSec / 3600) * 100) / 100 : null,
      start: this.startField ? (f[this.startField] ?? null) : null,
      due: f.duedate ?? null,
      session: null,
      dependsOn,
      status: statusName,
      statusCategory: category,
      notes: adfToText(f.description).trim(),
      url: `${this.cfg.baseUrl}/browse/${it.key}`,
    };
  }

  private fieldsFor(t: Task): any {
    const labels = [`nid-${t.id}`, roleLabel(t.role)];
    if (t.statusCategory === 'cancelled') labels.push('cancelled');
    const fields: any = { summary: t.title, labels, description: textToAdf(t.notes) };
    if (t.due) fields.duedate = t.due;
    if (t.start && this.startField) fields[this.startField] = t.start;
    if (t.estimateHours != null) fields.timetracking = { originalEstimate: `${t.estimateHours}h` };
    return fields;
  }

  async createIssue(t: Task): Promise<string> {
    const fields = this.fieldsFor(t);
    fields.project = { key: this.cfg.projectKey };
    fields.issuetype = { name: this.cfg.issueType };
    const res = await this.api('/rest/api/3/issue', { method: 'POST', body: JSON.stringify({ fields }) });
    return res.key;
  }

  async updateIssue(key: string, t: Task): Promise<void> {
    await this.api(`/rest/api/3/issue/${key}`, { method: 'PUT', body: JSON.stringify({ fields: this.fieldsFor(t) }) });
  }

  async linkBlocks(blockerKey: string, blockedKey: string): Promise<void> {
    await this.api('/rest/api/3/issueLink', {
      method: 'POST',
      body: JSON.stringify({
        type: { name: 'Blocks' },
        outwardIssue: { key: blockerKey },
        inwardIssue: { key: blockedKey },
      }),
    });
  }

}
