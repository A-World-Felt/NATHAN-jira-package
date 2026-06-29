import { statusInfo } from './mapping.js';
import type { Task } from './types.js';

function splitRow(line: string): string[] {
  const cells = line.split('|');
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}
function isTaskHeader(cells: string[]): boolean {
  return cells[0] === 'ID' && cells.includes('Tâche') && cells.includes('Statut');
}
function isSeparator(line: string): boolean {
  return line.includes('-') && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line);
}
function esc(s: string): string {
  return (s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function renderRow(t: Task): string {
  const cancelled = t.statusCategory === 'cancelled';
  const title = cancelled ? `~~${t.title}~~` : t.title;
  const est = t.estimateHours != null ? `${t.estimateHours}h` : '—';
  const deps = t.dependsOn.length ? t.dependsOn.join(',') : '—';
  const glyph = cancelled ? '[x]' : statusInfo(t.status).glyph;
  const cols = [t.id, esc(title), t.role || '—', est, t.session ?? '—',
    t.start ?? '—', t.due ?? '—', deps, glyph, esc(t.notes)];
  return '|' + cols.map((c) => c.length > 0 ? ` ${c} |` : ' |').join('');
}

const NEW_HEADER = '| ID | Tâche | Rôle | Est. | Période | Début | Fin | Dépend de | Statut | Notes |';
const NEW_SEP = '|----|-------|------|------|---------|-------|-----|-----------|--------|-------|';

export function regenerate(markdown: string, jiraTasks: Task[]): string {
  const byId = new Map(jiraTasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let inTable = false;

  for (const line of lines) {
    if (line.trim().startsWith('|')) {
      const cells = splitRow(line);
      if (isTaskHeader(cells)) { inTable = true; out.push(line); continue; }
      if (inTable && isSeparator(line)) { out.push(line); continue; }
      if (inTable) {
        const id = cells[0];
        const t = byId.get(id);
        if (t) { out.push(renderRow(t)); seen.add(id); }
        else { out.push(line); } // ID absent de JIRA -> ligne intacte
        continue;
      }
      out.push(line);
      continue;
    }
    if (line.trim() === '') inTable = false;
    out.push(line);
  }

  const fresh = jiraTasks.filter((t) => !seen.has(t.id));
  if (fresh.length) {
    out.push('', '## Tâches ajoutées dans JIRA (non classées)', '',
      '> Régénéré par `npm run taches:sync`. Déplace ces lignes dans le tableau du bon bloc pour qu\'elles y soient rafraîchies ensuite.',
      '', NEW_HEADER, NEW_SEP);
    for (const t of fresh) out.push(renderRow(t));
    out.push('');
  }
  return out.join('\n');
}
