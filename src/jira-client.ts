import type { Config } from './types.js';

type FetchFn = typeof fetch;

export class JiraClient {
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
}
