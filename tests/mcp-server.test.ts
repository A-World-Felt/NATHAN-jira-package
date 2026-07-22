import { describe, it, expect } from 'vitest';
import { buildServer, type ServerCtx } from '../src/mcp-server.js';
import { PlanStore } from '../src/mcp/guard.js';
import type { JiraSnapshot } from '../src/snapshot.js';

function fakeCtx(over: Partial<ServerCtx> = {}): ServerCtx {
  const snap: JiraSnapshot = { takenAt: '2026-07-22T00:00:00Z', baseUrl: 'https://x', projectKeys: ['DEV'], count: 0, issues: [] };
  return {
    profile: null,
    store: new PlanStore(() => 0, 600_000),
    fetchSnapshot: async () => snap,
    applyPlan: async () => ({ ok: false, reason: 'unknown_or_expired' }),
    today: () => '2026-07-22',
    ...over,
  };
}

describe('buildServer', () => {
  it('construit un serveur MCP et enregistre les tools sans lever (câblage valide)', () => {
    const server = buildServer(fakeCtx());
    expect(server).toBeTruthy();
    // l'objet McpServer expose le Server sous-jacent
    expect(typeof (server as any).connect).toBe('function');
  });

  it('accepte un contexte avec profil (mode convention-aware)', () => {
    const server = buildServer(fakeCtx({ profile: { name: 'nathan', mapLabels: () => ['bloc-ide'] } }));
    expect(server).toBeTruthy();
  });
});
