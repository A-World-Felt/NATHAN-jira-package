// src/mcp/server-config.ts — Résolution de la configuration du serveur MCP (PURE).
//
// Lit une config d'environnement (chargée depuis ~/.nathan/jira.env par l'entrée serveur) et
// produit une JiraConnConfig + le spécificateur de profil + le dossier de snapshots. Aucune I/O
// ici (dotenv est chargé par l'appelant) → testable avec un objet env factice.
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { JiraConnConfig } from '../types.js';

export interface ServerConfig {
  conn: JiraConnConfig;
  profileSpec?: string;   // NATHAN_JIRA_PROFILE (nom de package ou chemin) — optionnel
  snapshotDir: string;    // NATHAN_SNAPSHOT_DIR ou défaut neutre ~/.nathan/snapshots
}

/** Résout la config serveur depuis un objet d'environnement. Lève si une variable requise manque. */
export function resolveEnvConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const need = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'] as const;
  const missing = need.filter((k) => !env[k] || env[k]!.trim() === '');
  if (missing.length) {
    throw new Error(`Variable(s) d'environnement manquante(s) : ${missing.join(', ')} (voir ~/.nathan/jira.env).`);
  }
  const projectKeys = (env.JIRA_PROJECT_KEYS || env.JIRA_PROJECT_KEY || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (!projectKeys.length) {
    throw new Error("Variable d'environnement manquante : JIRA_PROJECT_KEYS (au moins une clé de projet, ex. « LIVS,DEV,GES »).");
  }
  const conn: JiraConnConfig = {
    baseUrl: env.JIRA_BASE_URL!.trim().replace(/\/+$/, ''),
    email: env.JIRA_EMAIL!.trim(),
    apiToken: env.JIRA_API_TOKEN!.trim(),
    projectKeys,
    riskProject: (env.RISK_PROJECT_KEY || 'RISK').trim(),
  };
  const profileSpec = env.NATHAN_JIRA_PROFILE && env.NATHAN_JIRA_PROFILE.trim()
    ? env.NATHAN_JIRA_PROFILE.trim() : undefined;
  const snapshotDir = (env.NATHAN_SNAPSHOT_DIR && env.NATHAN_SNAPSHOT_DIR.trim())
    ? env.NATHAN_SNAPSHOT_DIR.trim() : join(homedir(), '.nathan', 'snapshots');
  return { conn, profileSpec, snapshotDir };
}
