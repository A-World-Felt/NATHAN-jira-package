import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

const full = {
  JIRA_BASE_URL: 'https://x.atlassian.net/',
  JIRA_EMAIL: 'a@b.c',
  JIRA_API_TOKEN: 'tok',
  JIRA_PROJECT_KEY: 'NATHAN',
};

describe('loadConfig', () => {
  it('charge une config complète et retire le slash final', () => {
    const c = loadConfig(full);
    expect(c.baseUrl).toBe('https://x.atlassian.net');
    expect(c.projectKey).toBe('NATHAN');
    expect(c.issueType).toBe('Task');
  });
  it('lève si une variable manque', () => {
    expect(() => loadConfig({ ...full, JIRA_API_TOKEN: '' })).toThrow(/JIRA_API_TOKEN/);
  });
});
