import { describe, it, expect } from 'vitest';
import { resolveEnvConfig } from '../src/mcp/server-config.js';

const base = {
  JIRA_BASE_URL: 'https://x.atlassian.net/',
  JIRA_EMAIL: 'me@x.com',
  JIRA_API_TOKEN: 'tok',
  JIRA_PROJECT_KEYS: 'LIVS, DEV ,GES',
};

describe('resolveEnvConfig', () => {
  it('construit la connexion, découpe les clés, retire le slash final de l’URL', () => {
    const r = resolveEnvConfig({ ...base } as any);
    expect(r.conn.baseUrl).toBe('https://x.atlassian.net');
    expect(r.conn.projectKeys).toEqual(['LIVS', 'DEV', 'GES']);
    expect(r.conn.riskProject).toBe('RISK'); // défaut
  });

  it('profileSpec absent par défaut, présent si NATHAN_JIRA_PROFILE fourni', () => {
    expect(resolveEnvConfig({ ...base } as any).profileSpec).toBeUndefined();
    expect(resolveEnvConfig({ ...base, NATHAN_JIRA_PROFILE: 'nathan-jira-profile' } as any).profileSpec)
      .toBe('nathan-jira-profile');
  });

  it('snapshotDir : défaut neutre si non fourni, sinon la valeur donnée', () => {
    expect(resolveEnvConfig({ ...base } as any).snapshotDir).toMatch(/[\\/]\.nathan[\\/]snapshots$/);
    expect(resolveEnvConfig({ ...base, NATHAN_SNAPSHOT_DIR: '/data/snaps' } as any).snapshotDir).toBe('/data/snaps');
  });

  it('variable requise manquante → erreur explicite', () => {
    expect(() => resolveEnvConfig({ JIRA_BASE_URL: 'x' } as any)).toThrow(/manquante/i);
    expect(() => resolveEnvConfig({ ...base, JIRA_PROJECT_KEYS: '' } as any)).toThrow(/projet|PROJECT/i);
  });
});
