import 'dotenv/config';
import type { Config } from './types.js';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY'] as const;
  const missing = required.filter((k) => !env[k] || env[k]!.trim() === '');
  if (missing.length) {
    throw new Error(`Variables d'environnement manquantes : ${missing.join(', ')}. Voir .env.example`);
  }
  return {
    baseUrl: env.JIRA_BASE_URL!.replace(/\/+$/, ''),
    email: env.JIRA_EMAIL!.trim(),
    apiToken: env.JIRA_API_TOKEN!.trim(),
    projectKey: env.JIRA_PROJECT_KEY!.trim(),
    issueType: (env.JIRA_ISSUE_TYPE && env.JIRA_ISSUE_TYPE.trim()) || 'Task',
  };
}
