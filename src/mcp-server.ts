#!/usr/bin/env node
// src/mcp-server.ts — Serveur MCP JIRA NATHAN (transport stdio).
//
// Expose des VERBES de gestion aux agents (Claude Code & co.) : lecture libre, écritures GARDÉES
// (modèle B — verbe → planId+aperçu → validation → jira_apply sous garde + snapshot préventif).
// Le serveur reste NEUTRE : les conventions viennent d'un profil optionnel (NATHAN_JIRA_PROFILE).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import type { JiraSnapshot, RawIssue } from './snapshot.js';
import { fetchFullSnapshot, indexSnapshot } from './snapshot.js';
import { applyChanges } from './taches-apply.js';
import { JiraClient } from './jira-client.js';
import type { JiraWriteClient } from './jira-write.js';
import { fileTimestamp } from './jira-write.js';
import { loadProfile, type ConventionProfile } from './profile.js';
import { resolveEnvConfig } from './mcp/server-config.js';
import { PlanStore, collectRefs, computeFingerprint, applyGuarded, type GuardOutcome } from './mcp/guard.js';
import { runView, type ViewName } from './mcp/views.js';
import * as verbs from './mcp/verbs.js';

// ---------------------------------------------------------------------------
// Contexte injectable (permet le smoke-test sans JIRA live)
// ---------------------------------------------------------------------------
export interface ServerCtx {
  profile: ConventionProfile | null;
  store: PlanStore;
  fetchSnapshot: () => Promise<JiraSnapshot>;
  applyPlan: (planId: string) => Promise<GuardOutcome>;
  today: () => string;
}

type ToolResult = { content: Array<{ type: 'text'; text: string }> };
const text = (s: string): ToolResult => ({ content: [{ type: 'text', text: s }] });
const json = (v: unknown): ToolResult => text(JSON.stringify(v, null, 2));

// ---------------------------------------------------------------------------
// buildServer — enregistre tous les tools sur le contexte fourni
// ---------------------------------------------------------------------------
export function buildServer(ctx: ServerCtx): McpServer {
  const server = new McpServer({ name: 'nathan-jira', version: '0.1.0' });

  // --- Lecture ---
  server.registerTool('jira_snapshot',
    { description: 'Prend un snapshot JIRA live et renvoie un résumé (nombre d’issues par projet).' },
    async () => {
      const snap = await ctx.fetchSnapshot();
      return json({ takenAt: snap.takenAt, count: snap.count, projects: snap.projectKeys });
    });

  server.registerTool('jira_view',
    {
      description: 'Vue d’analyse sur l’état live : overdue, upcoming, inprogress, blocked, person, metrics.',
      inputSchema: {
        view: z.enum(['overdue', 'upcoming', 'inprogress', 'blocked', 'person', 'metrics']),
        days: z.number().int().positive().optional(),
        person: z.string().optional(),
      },
    },
    async (args) => {
      const snap = await ctx.fetchSnapshot();
      const result = runView(args.view as ViewName, snap.issues, {
        today: ctx.today(), days: args.days, person: args.person,
      });
      return json(result);
    });

  // --- Écriture : verbes → plan (jamais appliqué ici) ---
  const propose = async (r: verbs.VerbResult): Promise<ToolResult> => {
    const refs = collectRefs(r.changeset);
    const snap = await ctx.fetchSnapshot();
    const fingerprint = computeFingerprint(snap.issues, refs);
    const planId = ctx.store.put({ changeset: r.changeset, refs, fingerprint, preview: r.preview });
    return text(`PLAN ${planId} — à valider, puis appeler jira_apply({ planId: "${planId}" })\n\n${r.preview}`);
  };

  server.registerTool('jira_add_task',
    {
      description: 'Proposer la création d’une tâche (projet + epic explicites ; bloc optionnel si profil).',
      inputSchema: {
        project: z.string(), summary: z.string(), epicKey: z.string(),
        start: z.string().nullable().optional(), due: z.string().nullable().optional(),
        labels: z.array(z.string()).optional(), assignee: z.string().nullable().optional(),
        estimateHours: z.number().nullable().optional(), bloc: z.string().optional(),
      },
    },
    async (a) => propose(verbs.addTask(a, ctx.profile ?? undefined)));

  server.registerTool('jira_add_subtasks',
    {
      description: 'Proposer l’ajout de sous-tâches à une tâche parente.',
      inputSchema: {
        parentKey: z.string(),
        subtasks: z.array(z.object({
          summary: z.string(), assignee: z.string().nullable().optional(),
          estimateHours: z.number().nullable().optional(),
          start: z.string().nullable().optional(), due: z.string().nullable().optional(),
        })),
      },
    },
    async (a) => propose(verbs.addSubtasks(a)));

  server.registerTool('jira_reschedule',
    { description: 'Proposer de nouvelles dates de début/échéance.', inputSchema: { key: z.string(), start: z.string().optional(), due: z.string().optional() } },
    async (a) => propose(verbs.reschedule(a)));

  server.registerTool('jira_assign',
    { description: 'Proposer d’assigner (ou désassigner si null) une tâche.', inputSchema: { key: z.string(), assignee: z.string().nullable() } },
    async (a) => propose(verbs.assign(a)));

  server.registerTool('jira_set_estimate',
    { description: 'Proposer une estimation en heures (null pour effacer).', inputSchema: { key: z.string(), hours: z.number().nullable() } },
    async (a) => propose(verbs.setEstimate(a)));

  server.registerTool('jira_set_status',
    { description: 'Proposer une transition de statut.', inputSchema: { key: z.string(), statusName: z.string() } },
    async (a) => propose(verbs.setStatus(a)));

  server.registerTool('jira_link',
    { description: 'Proposer une dépendance (FS = bloque, SS = liée) entre deux tâches existantes.', inputSchema: { prereqKey: z.string(), taskKey: z.string(), type: z.enum(['FS', 'SS']) } },
    async (a) => propose(verbs.link(a)));

  server.registerTool('jira_delete',
    { description: 'Proposer la suppression d’une tâche.', inputSchema: { key: z.string(), reason: z.string().optional() } },
    async (a) => propose(verbs.deleteTask(a)));

  // --- Application : porte unique sous garde ---
  server.registerTool('jira_apply',
    { description: 'Appliquer un plan proposé (planId). Garde : plan frais + état non dérivé + snapshot préventif avant écriture.', inputSchema: { planId: z.string() } },
    async (a) => {
      const outcome = await ctx.applyPlan(a.planId);
      if (!outcome.ok && outcome.reason === 'unknown_or_expired') {
        return text('❌ Plan inconnu ou expiré (TTL). Reproposez le changement.');
      }
      if (!outcome.ok && outcome.reason === 'drift') {
        return text(`❌ Refusé : ${outcome.details}.`);
      }
      if (outcome.ok) {
        const r = outcome.result;
        return text(`✅ Appliqué. Créées:${r.created.length} Sous-tâches:${r.subtasks.length} MAJ:${r.updated.length} Liens:${r.links.length} Suppr:${r.deleted.length} Erreurs:${r.errors.length}\nSnapshot préventif : ${outcome.snapshotPath}${r.errors.length ? '\n' + r.errors.map((e) => '  ⛔ ' + e).join('\n') : ''}`);
      }
      return text('❌ Échec inconnu.');
    });

  return server;
}

// ---------------------------------------------------------------------------
// main — câble le contexte réel (config, client live, garde) et connecte stdio
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const { config: loadDotenv } = await import('dotenv');
  const envPath = process.env.NATHAN_JIRA_ENV || undefined; // défaut : dotenv cherche .env courant ; sinon chemin explicite
  loadDotenv({ path: envPath, override: true });

  const { conn, profileSpec, snapshotDir } = resolveEnvConfig(process.env);
  const profile = await loadProfile(profileSpec);

  const store = new PlanStore(() => Date.now(), 10 * 60 * 1000);
  const fetchSnapshot = () => fetchFullSnapshot(conn);

  // Client d'écriture construit paresseusement (init réseau) au premier apply.
  let writeClient: JiraWriteClient | null = null;
  const getClient = async (): Promise<JiraWriteClient> => {
    if (writeClient) return writeClient;
    const jc = new JiraClient({ ...conn, projectKey: conn.projectKeys[0] ?? 'LIVS', issueType: 'Task' } as any);
    await jc.init();
    writeClient = {
      baseUrl: conn.baseUrl,
      authHeader: 'Basic ' + Buffer.from(`${conn.email}:${conn.apiToken}`).toString('base64'),
      startFieldId: jc.getStartField(),
      fetchFn: fetch,
    };
    return writeClient;
  };

  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const writeSnapshot = async (issues: RawIssue[]): Promise<string> => {
    mkdirSync(snapshotDir, { recursive: true });
    const path = join(snapshotDir, `preventif-${fileTimestamp()}.json`);
    const snap: JiraSnapshot = {
      takenAt: new Date().toISOString(), baseUrl: conn.baseUrl,
      projectKeys: [...new Set([...conn.projectKeys, conn.riskProject])].filter(Boolean),
      count: issues.length, issues,
    };
    writeFileSync(path, JSON.stringify(snap, null, 2), 'utf8');
    return path;
  };

  const applyPlan = (planId: string): Promise<GuardOutcome> => applyGuarded({
    store,
    fetchSnapshot,
    writeSnapshot,
    indexSnapshot,
    applyChanges: async (cs, idx, issues) => applyChanges(await getClient(), cs, idx, issues),
  }, planId);

  const server = buildServer({ profile, store, fetchSnapshot, applyPlan, today: () => new Date().toISOString().slice(0, 10) });
  await server.connect(new StdioServerTransport());
  // Le serveur tourne sur stdio jusqu'à fermeture du flux.
}

// Lancé directement (bin) → démarre. Importé (tests) → n'exécute rien.
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error('[nathan-jira-mcp] ERREUR FATALE :', (e as Error).message); process.exit(1); });
}
