import type { Task, StatusCategory } from './types.js';

const SESSIONS: ReadonlyArray<{ code: string; start: string; end: string }> = [
  { code: 'S6', start: '2026-05-04', end: '2026-08-14' },
  { code: 'T4', start: '2026-09-08', end: '2026-12-18' },
  { code: 'S7', start: '2027-01-05', end: '2027-04-30' },
  { code: 'T5', start: '2027-05-03', end: '2027-08-13' },
  { code: 'S8', start: '2027-08-30', end: '2027-12-23' },
];

export function sessionFromDate(date: string | null): string | null {
  if (!date) return null;
  for (const s of SESSIONS) {
    if (date >= s.start && date <= s.end) return s.code; // comparaison lexicographique ISO
  }
  return null;
}

const STATUS_TABLE: Record<string, { category: StatusCategory; glyph: string }> = {
  'À Faire':    { category: 'todo',        glyph: '[ ]' },
  'En cours':   { category: 'in_progress', glyph: '[~]' },
  'Révision':   { category: 'in_progress', glyph: '[r]' },
  'Bloqué':     { category: 'in_progress', glyph: '[!]' },
  'Terminé(e)': { category: 'done',        glyph: '[x]' },
  'Terminé':    { category: 'done',        glyph: '[x]' },
};

export function statusInfo(name: string): { category: StatusCategory; glyph: string } {
  return STATUS_TABLE[(name || '').trim()] ?? { category: 'todo', glyph: '[ ]' };
}

export function computeOrder(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const t of tasks) { indeg.set(t.id, 0); adj.set(t.id, []); }
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!byId.has(dep)) continue; // orpheline -> ignorée
      adj.get(dep)!.push(t.id);
      indeg.set(t.id, (indeg.get(t.id) ?? 0) + 1);
    }
  }
  const cmp = (a: string, b: string): number => {
    const sa = byId.get(a)!.start ?? '9999-99-99';
    const sb = byId.get(b)!.start ?? '9999-99-99';
    if (sa !== sb) return sa < sb ? -1 : 1;
    return a < b ? -1 : 1;
  };
  const ready = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const out: string[] = [];
  while (ready.length) {
    ready.sort(cmp);
    const id = ready.shift()!;
    out.push(id);
    for (const nxt of adj.get(id)!) {
      indeg.set(nxt, indeg.get(nxt)! - 1);
      if (indeg.get(nxt) === 0) ready.push(nxt);
    }
  }
  if (out.length !== tasks.length) {
    return [...tasks].sort((x, y) => cmp(x.id, y.id)); // cycle -> fallback par date
  }
  return out.map((id) => byId.get(id)!);
}

export function findOrphanDeps(tasks: Task[]): Array<{ id: string; dep: string }> {
  const ids = new Set(tasks.map((t) => t.id));
  const out: Array<{ id: string; dep: string }> = [];
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!ids.has(dep)) out.push({ id: t.id, dep });
    }
  }
  return out;
}

export function hasCycle(tasks: Task[]): boolean {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const t of tasks) { indeg.set(t.id, 0); adj.set(t.id, []); }
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!byId.has(dep)) continue;
      adj.get(dep)!.push(t.id);
      indeg.set(t.id, (indeg.get(t.id) ?? 0) + 1);
    }
  }
  let visited = 0;
  const q = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  while (q.length) {
    const id = q.shift()!;
    visited++;
    for (const nxt of adj.get(id)!) {
      indeg.set(nxt, indeg.get(nxt)! - 1);
      if (indeg.get(nxt) === 0) q.push(nxt);
    }
  }
  return visited !== tasks.length;
}
